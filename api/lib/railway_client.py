# Created and developed by Jai Singh
"""Async client for Railway's GraphQL API v2.

Wraps httpx calls to https://backboard.railway.com/graphql/v2 and exposes
typed helpers for project overview, environment logs, deployments, and
deployment-level logs (runtime / build / HTTP).

The Railway API token is read from settings and kept server-side only.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

logger = logging.getLogger(__name__)

LogKind = Literal["runtime", "build", "http"]

# ---------------------------------------------------------------------------
# GraphQL query fragments
# ---------------------------------------------------------------------------

_PROJECT_OVERVIEW_QUERY = """
query projectOverview($id: String!) {
  project(id: $id) {
    id
    name
    environments {
      edges {
        node {
          id
          name
        }
      }
    }
    services {
      edges {
        node {
          id
          name
          icon
        }
      }
    }
  }
}
"""

_SERVICE_INSTANCE_QUERY = """
query serviceInstance($serviceId: String!, $environmentId: String!) {
  serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
    id
    serviceName
    startCommand
    region
    numReplicas
    latestDeployment {
      id
      status
      createdAt
    }
  }
}
"""

_ENVIRONMENT_LOGS_QUERY = """
query environmentLogs($environmentId: String!, $filter: String) {
  environmentLogs(environmentId: $environmentId, filter: $filter) {
    timestamp
    message
    severity
    tags {
      serviceId
      deploymentId
    }
  }
}
"""

_DEPLOYMENTS_QUERY = """
query deployments($input: DeploymentListInput!, $first: Int) {
  deployments(input: $input, first: $first) {
    edges {
      node {
        id
        status
        createdAt
        url
      }
    }
  }
}
"""

_DEPLOYMENT_LOGS_QUERY = """
query deploymentLogs($deploymentId: String!, $limit: Int) {
  deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
    timestamp
    message
    severity
  }
}
"""

_BUILD_LOGS_QUERY = """
query buildLogs($deploymentId: String!, $limit: Int) {
  buildLogs(deploymentId: $deploymentId, limit: $limit) {
    timestamp
    message
    severity
  }
}
"""

_HTTP_LOGS_QUERY = """
query httpLogs($deploymentId: String!, $limit: Int) {
  httpLogs(deploymentId: $deploymentId, limit: $limit) {
    timestamp
    requestId
    method
    path
    httpStatus
    totalDuration
    srcIp
  }
}
"""

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class RailwayService:
    id: str
    name: str
    icon: str | None = None


@dataclass
class RailwayEnvironment:
    id: str
    name: str


@dataclass
class LatestDeployment:
    id: str
    status: str
    created_at: str


@dataclass
class ServiceStatus:
    service: RailwayService
    latest_deployment: LatestDeployment | None = None
    region: str | None = None
    num_replicas: int | None = None


@dataclass
class ProjectOverview:
    project_id: str
    project_name: str
    environment_id: str
    environment_name: str
    services: list[ServiceStatus] = field(default_factory=list)


@dataclass
class NormalizedLog:
    timestamp: str
    severity: str
    message: str
    service_id: str = ""
    service_name: str = ""
    deployment_id: str = ""
    kind: str = "runtime"
    http_status: int | None = None
    request_id: str = ""
    method: str = ""
    path: str = ""
    dedup_key: str = ""


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class RailwayClient:
    """Thin async wrapper around Railway's GraphQL API."""

    def __init__(self, api_url: str, api_token: str, project_id: str, environment_name: str) -> None:
        self._api_url = api_url
        self._headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        }
        self._project_id = project_id
        self._environment_name = environment_name
        self._env_id_cache: str | None = None
        self._service_name_map: dict[str, str] = {}

    async def _post(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                self._api_url,
                json={"query": query, "variables": variables},
                headers=self._headers,
            )
            resp.raise_for_status()
            body = resp.json()
            if "errors" in body:
                logger.error("Railway GraphQL errors: %s", body["errors"])
                raise RuntimeError(f"Railway API error: {body['errors'][0].get('message', 'Unknown')}")
            return body.get("data", {})

    # ---- Project overview ---------------------------------------------------

    async def get_project_overview(self) -> ProjectOverview:
        data = await self._post(_PROJECT_OVERVIEW_QUERY, {"id": self._project_id})
        project = data.get("project", {})

        environments: list[RailwayEnvironment] = []
        for edge in project.get("environments", {}).get("edges", []):
            node = edge["node"]
            environments.append(RailwayEnvironment(id=node["id"], name=node["name"]))

        env = next(
            (e for e in environments if e.name.lower() == self._environment_name.lower()),
            environments[0] if environments else None,
        )
        if not env:
            raise RuntimeError(f"Environment '{self._environment_name}' not found in project")

        self._env_id_cache = env.id

        services: list[RailwayService] = []
        for edge in project.get("services", {}).get("edges", []):
            node = edge["node"]
            svc = RailwayService(id=node["id"], name=node["name"], icon=node.get("icon"))
            services.append(svc)
            self._service_name_map[svc.id] = svc.name

        statuses: list[ServiceStatus] = []
        for svc in services:
            try:
                inst_data = await self._post(_SERVICE_INSTANCE_QUERY, {
                    "serviceId": svc.id,
                    "environmentId": env.id,
                })
                inst = inst_data.get("serviceInstance", {})
                latest = inst.get("latestDeployment")
                statuses.append(ServiceStatus(
                    service=svc,
                    latest_deployment=LatestDeployment(
                        id=latest["id"],
                        status=latest["status"],
                        created_at=latest["createdAt"],
                    ) if latest else None,
                    region=inst.get("region"),
                    num_replicas=inst.get("numReplicas"),
                ))
            except Exception as exc:
                logger.warning("Failed to get instance for service %s: %s", svc.name, exc)
                statuses.append(ServiceStatus(service=svc))

        return ProjectOverview(
            project_id=self._project_id,
            project_name=project.get("name", ""),
            environment_id=env.id,
            environment_name=env.name,
            services=statuses,
        )

    # ---- Environment-wide runtime logs --------------------------------------

    async def _resolve_env_id(self) -> str:
        if self._env_id_cache:
            return self._env_id_cache
        overview = await self.get_project_overview()
        return overview.environment_id

    async def get_environment_runtime_logs(
        self,
        *,
        service_id: str | None = None,
        filter_text: str | None = None,
        limit: int = 200,
    ) -> list[NormalizedLog]:
        env_id = await self._resolve_env_id()
        data = await self._post(_ENVIRONMENT_LOGS_QUERY, {
            "environmentId": env_id,
            "filter": filter_text,
        })

        raw_logs = data.get("environmentLogs", []) or []
        logs: list[NormalizedLog] = []
        for entry in raw_logs:
            tags = entry.get("tags") or {}
            sid = tags.get("serviceId", "")
            if service_id and sid != service_id:
                continue
            log = NormalizedLog(
                timestamp=entry.get("timestamp", ""),
                severity=_normalize_severity(entry.get("severity", "")),
                message=entry.get("message", ""),
                service_id=sid,
                service_name=self._service_name_map.get(sid, sid),
                deployment_id=tags.get("deploymentId", ""),
                kind="runtime",
            )
            log.dedup_key = _make_dedup_key(log)
            logs.append(log)

        return logs[-limit:]

    # ---- Deployments --------------------------------------------------------

    async def get_service_deployments(
        self,
        service_id: str,
        *,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        env_id = await self._resolve_env_id()
        data = await self._post(_DEPLOYMENTS_QUERY, {
            "input": {
                "projectId": self._project_id,
                "serviceId": service_id,
                "environmentId": env_id,
            },
            "first": limit,
        })
        edges = data.get("deployments", {}).get("edges", [])
        return [
            {
                "id": e["node"]["id"],
                "status": e["node"]["status"],
                "createdAt": e["node"]["createdAt"],
                "url": e["node"].get("url", ""),
            }
            for e in edges
        ]

    # ---- Deployment-level logs ----------------------------------------------

    async def get_deployment_logs(
        self,
        deployment_id: str,
        *,
        kind: LogKind = "runtime",
        limit: int = 500,
    ) -> list[NormalizedLog]:
        if kind == "http":
            return await self._get_http_logs(deployment_id, limit=limit)
        query = _DEPLOYMENT_LOGS_QUERY if kind == "runtime" else _BUILD_LOGS_QUERY
        data = await self._post(query, {
            "deploymentId": deployment_id,
            "limit": limit,
        })
        key = "deploymentLogs" if kind == "runtime" else "buildLogs"
        raw = data.get(key, []) or []
        logs: list[NormalizedLog] = []
        for entry in raw:
            log = NormalizedLog(
                timestamp=entry.get("timestamp", ""),
                severity=_normalize_severity(entry.get("severity", "")),
                message=entry.get("message", ""),
                deployment_id=deployment_id,
                kind=kind,
            )
            log.dedup_key = _make_dedup_key(log)
            logs.append(log)
        return logs

    async def _get_http_logs(self, deployment_id: str, *, limit: int = 500) -> list[NormalizedLog]:
        data = await self._post(_HTTP_LOGS_QUERY, {
            "deploymentId": deployment_id,
            "limit": limit,
        })
        raw = data.get("httpLogs", []) or []
        logs: list[NormalizedLog] = []
        for entry in raw:
            status_code = entry.get("httpStatus")
            severity = "error" if status_code and int(status_code) >= 500 else (
                "warn" if status_code and int(status_code) >= 400 else "info"
            )
            log = NormalizedLog(
                timestamp=entry.get("timestamp", ""),
                severity=severity,
                message=f"{entry.get('method', '')} {entry.get('path', '')} {status_code or ''} {entry.get('totalDuration', '')}ms",
                deployment_id=deployment_id,
                kind="http",
                http_status=int(status_code) if status_code else None,
                request_id=entry.get("requestId", ""),
                method=entry.get("method", ""),
                path=entry.get("path", ""),
            )
            log.dedup_key = _make_dedup_key(log)
            logs.append(log)
        return logs


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalize_severity(raw: str) -> str:
    mapping = {
        "INFO": "info",
        "WARN": "warn",
        "WARNING": "warn",
        "ERROR": "error",
        "ERR": "error",
        "DEBUG": "debug",
        "TRACE": "debug",
        "FATAL": "error",
        "CRITICAL": "error",
    }
    return mapping.get(raw.upper().strip(), raw.lower().strip() or "info")


def _make_dedup_key(log: NormalizedLog) -> str:
    return f"{log.timestamp}|{log.service_id}|{log.deployment_id}|{log.message[:120]}"

# Created and developed by Jai Singh
