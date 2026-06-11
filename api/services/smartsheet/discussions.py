# Created and developed by Jai Singh
"""Discussion / comment mixin for SmartsheetService."""

import asyncio
import logging
from typing import Optional, Dict, List, Any

import smartsheet

from .client import _SMARTSHEET_EXECUTOR
from .mappers import SmartsheetResponse

logger = logging.getLogger(__name__)


class _DiscussionsMixin:
    """Discussion and comment methods.

    Mixed into the final ``SmartsheetService`` class so that ``self`` has
    access to ``_rate_limit_check``, ``_log_activity``, ``_handle_api_error``,
    ``_safe_dict_conversion``, and ``_client``.
    """

    async def list_row_discussions(self, sheet_id: int, row_id: int) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            response = self._client.Discussions.list_row_discussions(sheet_id, row_id)

            if response.request_response.status_code == 200:
                discussions_data = []
                for discussion in response.data:
                    comments_data = []
                    if hasattr(discussion, 'comments') and discussion.comments:
                        for comment in discussion.comments:
                            comments_data.append({
                                "id": comment.id,
                                "text": comment.text,
                                "created_at": comment.created_at.isoformat() if comment.created_at else None,
                                "created_by": self._safe_dict_conversion(comment.created_by),
                                "modified_at": comment.modified_at.isoformat() if comment.modified_at else None
                            })

                    discussions_data.append({
                        "id": discussion.id,
                        "title": discussion.title,
                        "created_at": discussion.created_at.isoformat() if discussion.created_at else None,
                        "created_by": self._safe_dict_conversion(discussion.created_by),
                        "modified_at": discussion.modified_at.isoformat() if discussion.modified_at else None,
                        "comment_count": discussion.comment_count or 0,
                        "comments": comments_data
                    })

                await self._log_activity("list_row_discussions", sheet_id=sheet_id,
                                        details={"discussion_count": len(discussions_data), "row_id": row_id})

                return SmartsheetResponse(
                    success=True,
                    data={"discussions": discussions_data},
                    message=f"Found {len(discussions_data)} discussions"
                )
            else:
                raise Exception(f"List discussions failed with status: {response.request_response.status_code}")

        except Exception as e:
            await self._log_activity("list_row_discussions", sheet_id=sheet_id,
                                    status="error", error_message=str(e), details={"row_id": row_id})
            return await self._handle_api_error(e)

    async def create_row_discussion(self, sheet_id: int, row_id: int, title: str,
                                   comment_text: str) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            discussion = smartsheet.models.Discussion()
            discussion.title = title

            comment = smartsheet.models.Comment()
            comment.text = comment_text
            discussion.comments = [comment]

            response = self._client.Discussions.create_discussion_on_row(sheet_id, row_id, discussion)

            if response.request_response.status_code == 200:
                discussion_data = {
                    "id": response.data.id,
                    "title": response.data.title,
                    "created_at": response.data.created_at.isoformat() if response.data.created_at else None,
                    "created_by": self._safe_dict_conversion(response.data.created_by),
                    "comment_count": response.data.comment_count or 0
                }

                await self._log_activity("create_row_discussion", sheet_id=sheet_id,
                                        details={"title": title, "row_id": row_id})

                return SmartsheetResponse(
                    success=True,
                    data={"discussion": discussion_data},
                    message=f"Successfully created discussion: {title}"
                )
            else:
                raise Exception(f"Create discussion failed with status: {response.request_response.status_code}")

        except Exception as e:
            await self._log_activity("create_row_discussion", sheet_id=sheet_id,
                                    status="error", error_message=str(e), details={"row_id": row_id})
            return await self._handle_api_error(e)

    async def add_comment_to_discussion(self, sheet_id: int, discussion_id: int,
                                       comment_text: str) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            comment = smartsheet.models.Comment()
            comment.text = comment_text

            response = self._client.Discussions.add_comment_to_discussion(sheet_id, discussion_id, comment)

            if response.request_response.status_code == 200:
                comment_data = {
                    "id": response.data.id,
                    "text": response.data.text,
                    "created_at": response.data.created_at.isoformat() if response.data.created_at else None,
                    "created_by": self._safe_dict_conversion(response.data.created_by)
                }

                await self._log_activity("add_comment_to_discussion", sheet_id=sheet_id,
                                        details={"discussion_id": discussion_id})

                return SmartsheetResponse(
                    success=True,
                    data={"comment": comment_data},
                    message="Successfully added comment to discussion"
                )
            else:
                raise Exception(f"Add comment failed with status: {response.request_response.status_code}")

        except Exception as e:
            await self._log_activity("add_comment_to_discussion", sheet_id=sheet_id,
                                    status="error", error_message=str(e))
            return await self._handle_api_error(e)

    async def get_discussion(self, sheet_id: int, discussion_id: int) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                _SMARTSHEET_EXECUTOR,
                lambda: self._client.Discussions.get_discussion(sheet_id, discussion_id)
            )

            if response.request_response.status_code == 200:
                discussion = response.data
                comments_data = []
                if hasattr(discussion, 'comments') and discussion.comments:
                    for comment in discussion.comments:
                        comment_attachments = []
                        if hasattr(comment, 'attachments') and comment.attachments:
                            for att in comment.attachments:
                                comment_attachments.append({
                                    "id": att.id,
                                    "name": att.name,
                                    "attachment_type": str(att.attachment_type),
                                    "mime_type": att.mime_type,
                                    "size_in_kb": att.size_in_kb,
                                    "url": att.url
                                })

                        comments_data.append({
                            "id": comment.id,
                            "text": comment.text,
                            "created_at": comment.created_at.isoformat() if comment.created_at else None,
                            "created_by": self._safe_dict_conversion(comment.created_by),
                            "modified_at": comment.modified_at.isoformat() if comment.modified_at else None,
                            "attachments": comment_attachments
                        })

                discussion_data = {
                    "id": discussion.id,
                    "title": discussion.title,
                    "created_at": discussion.created_at.isoformat() if discussion.created_at else None,
                    "created_by": self._safe_dict_conversion(discussion.created_by),
                    "modified_at": discussion.modified_at.isoformat() if discussion.modified_at else None,
                    "comment_count": discussion.comment_count or 0,
                    "comments": comments_data
                }

                await self._log_activity("get_discussion", sheet_id=sheet_id,
                                        details={"discussion_id": discussion_id})

                return SmartsheetResponse(
                    success=True,
                    data={"discussion": discussion_data},
                    message="Discussion retrieved successfully"
                )
            else:
                raise Exception(f"Get discussion failed with status: {response.request_response.status_code}")

        except Exception as e:
            await self._log_activity("get_discussion", sheet_id=sheet_id,
                                    status="error", error_message=str(e), details={"discussion_id": discussion_id})
            return await self._handle_api_error(e)

    async def delete_discussion(self, sheet_id: int, discussion_id: int) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                _SMARTSHEET_EXECUTOR,
                lambda: self._client.Discussions.delete_discussion(sheet_id, discussion_id)
            )

            if response.request_response.status_code == 200:
                await self._log_activity("delete_discussion", sheet_id=sheet_id,
                                        details={"discussion_id": discussion_id})
                return SmartsheetResponse(
                    success=True,
                    message=f"Successfully deleted discussion {discussion_id}"
                )
            else:
                raise Exception(f"Delete discussion failed with status: {response.request_response.status_code}")

        except Exception as e:
            await self._log_activity("delete_discussion", sheet_id=sheet_id,
                                    status="error", error_message=str(e))
            return await self._handle_api_error(e)

    async def update_comment(self, sheet_id: int, comment_id: int, text: str) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            comment = smartsheet.models.Comment()
            comment.text = text

            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                _SMARTSHEET_EXECUTOR,
                lambda: self._client.Discussions.update_comment(sheet_id, comment_id, comment)
            )

            if response.request_response.status_code == 200:
                comment_data = {
                    "id": response.data.id,
                    "text": response.data.text,
                    "created_at": response.data.created_at.isoformat() if response.data.created_at else None,
                    "created_by": self._safe_dict_conversion(response.data.created_by),
                    "modified_at": response.data.modified_at.isoformat() if response.data.modified_at else None
                }

                await self._log_activity("update_comment", sheet_id=sheet_id,
                                        details={"comment_id": comment_id})

                return SmartsheetResponse(
                    success=True,
                    data={"comment": comment_data},
                    message="Comment updated successfully"
                )
            else:
                raise Exception(f"Update comment failed with status: {response.request_response.status_code}")

        except Exception as e:
            await self._log_activity("update_comment", sheet_id=sheet_id,
                                    status="error", error_message=str(e))
            return await self._handle_api_error(e)

    async def delete_comment(self, sheet_id: int, comment_id: int) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                _SMARTSHEET_EXECUTOR,
                lambda: self._client.Discussions.delete_comment(sheet_id, comment_id)
            )

            if response.request_response.status_code == 200:
                await self._log_activity("delete_comment", sheet_id=sheet_id,
                                        details={"comment_id": comment_id})
                return SmartsheetResponse(
                    success=True,
                    message=f"Successfully deleted comment {comment_id}"
                )
            else:
                raise Exception(f"Delete comment failed with status: {response.request_response.status_code}")

        except Exception as e:
            await self._log_activity("delete_comment", sheet_id=sheet_id,
                                    status="error", error_message=str(e))
            return await self._handle_api_error(e)

# Created and developed by Jai Singh
