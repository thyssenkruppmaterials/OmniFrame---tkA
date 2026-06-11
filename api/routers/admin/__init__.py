# Created and developed by Jai Singh
"""Admin router package -- aggregates sub-routers into a single ``router``."""

import logging

from fastapi import APIRouter

from .system import router as system_router
from .roles import router as roles_router
from .users import router as users_router
from .railway import router as railway_router

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])
router.include_router(system_router)
router.include_router(roles_router)
router.include_router(users_router)
router.include_router(railway_router)

logger.info("Admin router package loaded successfully")

# Created and developed by Jai Singh
