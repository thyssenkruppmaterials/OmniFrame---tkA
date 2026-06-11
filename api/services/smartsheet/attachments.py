# Created and developed by Jai Singh
"""Attachment mixin for SmartsheetService."""

import asyncio
import logging
from typing import Optional, Dict, List, Any

import smartsheet

from .client import _SMARTSHEET_EXECUTOR
from .mappers import SmartsheetResponse

logger = logging.getLogger(__name__)


class _AttachmentsMixin:
    """Attachment upload / download / management methods.

    Mixed into the final ``SmartsheetService`` class so that ``self`` has
    access to ``_rate_limit_check``, ``_log_activity``, ``_handle_api_error``,
    ``_safe_dict_conversion``, and ``_client``.
    """

    async def list_row_attachments(self, sheet_id: int, row_id: int) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            response = self._client.Attachments.list_row_attachments(sheet_id, row_id)

            if response.request_response.status_code == 200:
                attachments_data = []
                for attachment in response.data:
                    attachments_data.append({
                        "id": attachment.id,
                        "name": attachment.name,
                        "attachment_type": str(attachment.attachment_type),
                        "mime_type": attachment.mime_type,
                        "size_in_kb": attachment.size_in_kb,
                        "created_at": attachment.created_at.isoformat() if attachment.created_at else None,
                        "created_by": self._safe_dict_conversion(attachment.created_by),
                        "url": attachment.url,
                        "url_expires_in_millis": attachment.url_expires_in_millis
                    })

                await self._log_activity("list_row_attachments", sheet_id=sheet_id,
                                        details={"attachment_count": len(attachments_data), "row_id": row_id})

                return SmartsheetResponse(
                    success=True,
                    data={"attachments": attachments_data},
                    message=f"Found {len(attachments_data)} attachments"
                )
            else:
                raise Exception(f"List attachments failed with status: {response.request_response.status_code}")

        except Exception as e:
            await self._log_activity("list_row_attachments", sheet_id=sheet_id,
                                    status="error", error_message=str(e), details={"row_id": row_id})
            return await self._handle_api_error(e)

    async def attach_file_to_row(self, sheet_id: int, row_id: int, file_path: str,
                                file_name: Optional[str] = None) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            response = self._client.Attachments.attach_file_to_row(
                sheet_id, row_id, file_path, file_name
            )

            if response.request_response.status_code == 200:
                attachment_data = {
                    "id": response.data.id,
                    "name": response.data.name,
                    "attachment_type": str(response.data.attachment_type),
                    "mime_type": response.data.mime_type,
                    "size_in_kb": response.data.size_in_kb,
                    "created_at": response.data.created_at.isoformat() if response.data.created_at else None,
                    "created_by": self._safe_dict_conversion(response.data.created_by)
                }

                await self._log_activity("attach_file_to_row", sheet_id=sheet_id,
                                        details={"file_name": file_name or file_path, "row_id": row_id})

                return SmartsheetResponse(
                    success=True,
                    data={"attachment": attachment_data},
                    message=f"Successfully attached file: {file_name or file_path}"
                )
            else:
                raise Exception(f"File attachment failed with status: {response.request_response.status_code}")

        except Exception as e:
            await self._log_activity("attach_file_to_row", sheet_id=sheet_id,
                                    status="error", error_message=str(e), details={"row_id": row_id})
            return await self._handle_api_error(e)

    async def delete_attachment(self, sheet_id: int, attachment_id: int) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            response = self._client.Attachments.delete_attachment(sheet_id, attachment_id)

            if response.request_response.status_code == 200:
                await self._log_activity("delete_attachment", sheet_id=sheet_id,
                                        details={"attachment_id": attachment_id})
                return SmartsheetResponse(
                    success=True,
                    message=f"Successfully deleted attachment {attachment_id}"
                )
            else:
                raise Exception(f"Delete attachment failed with status: {response.request_response.status_code}")

        except Exception as e:
            await self._log_activity("delete_attachment", sheet_id=sheet_id,
                                    status="error", error_message=str(e))
            return await self._handle_api_error(e)

    async def get_attachment_download_url(self, sheet_id: int, attachment_id: int) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            response = self._client.Attachments.get_attachment(sheet_id, attachment_id)

            if response.request_response.status_code == 200:
                attachment_data = {
                    "id": response.data.id,
                    "name": response.data.name,
                    "url": response.data.url,
                    "url_expires_in_millis": response.data.url_expires_in_millis,
                    "mime_type": response.data.mime_type,
                    "size_in_kb": response.data.size_in_kb
                }

                await self._log_activity("get_attachment_download_url", sheet_id=sheet_id,
                                        details={"attachment_id": attachment_id})

                return SmartsheetResponse(
                    success=True,
                    data={"attachment": attachment_data},
                    message="Successfully retrieved download URL"
                )
            else:
                raise Exception(f"Get attachment failed with status: {response.request_response.status_code}")

        except Exception as e:
            await self._log_activity("get_attachment_download_url", sheet_id=sheet_id,
                                    status="error", error_message=str(e))
            return await self._handle_api_error(e)

    async def attach_url_to_row(self, sheet_id: int, row_id: int, url: str,
                               attachment_name: str) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            attachment = smartsheet.models.Attachment()
            attachment.name = attachment_name
            attachment.url = url
            attachment.attachment_type = smartsheet.models.enums.AttachmentType.LINK

            response = self._client.Attachments.attach_url_to_row(sheet_id, row_id, attachment)

            if response.request_response.status_code == 200:
                attachment_data = {
                    "id": response.data.id,
                    "name": response.data.name,
                    "url": response.data.url,
                    "attachment_type": str(response.data.attachment_type),
                    "created_at": response.data.created_at.isoformat() if response.data.created_at else None,
                    "created_by": self._safe_dict_conversion(response.data.created_by)
                }

                await self._log_activity("attach_url_to_row", sheet_id=sheet_id,
                                        details={"url": url, "name": attachment_name, "row_id": row_id})

                return SmartsheetResponse(
                    success=True,
                    data={"attachment": attachment_data},
                    message=f"Successfully attached URL: {attachment_name}"
                )
            else:
                raise Exception(f"URL attachment failed with status: {response.request_response.status_code}")

        except Exception as e:
            await self._log_activity("attach_url_to_row", sheet_id=sheet_id,
                                    status="error", error_message=str(e), details={"row_id": row_id})
            return await self._handle_api_error(e)

    async def upload_file_to_row(self, sheet_id: int, row_id: int, file_content: bytes,
                                 file_name: str, content_type: str) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            import os
            from io import BytesIO

            safe_file_name = os.path.basename(file_name)

            logger.info(f"[UPLOAD DEBUG] Using BytesIO approach with filename: {safe_file_name}")

            file_stream = BytesIO(file_content)

            try:
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(
                    _SMARTSHEET_EXECUTOR,
                    lambda: self._client.Attachments.attach_file_to_row(
                        sheet_id, row_id, (safe_file_name, file_stream, content_type)
                    )
                )

                logger.info(f"[UPLOAD DEBUG] Response attachment name: {response.data.name if response.data else 'N/A'}")

                if response.request_response.status_code == 200:
                    attachment_data = {
                        "id": response.data.id,
                        "name": response.data.name,
                        "attachment_type": str(response.data.attachment_type),
                        "mime_type": response.data.mime_type,
                        "size_in_kb": response.data.size_in_kb,
                        "created_at": response.data.created_at.isoformat() if response.data.created_at else None,
                        "created_by": self._safe_dict_conversion(response.data.created_by)
                    }

                    logger.info(f"[UPLOAD DEBUG] Final attachment name in Smartsheet: {response.data.name}")

                    await self._log_activity("upload_file_to_row", sheet_id=sheet_id,
                                            details={"file_name": safe_file_name, "row_id": row_id, "size_kb": response.data.size_in_kb})

                    return SmartsheetResponse(
                        success=True,
                        data={"attachment": attachment_data},
                        message=f"Successfully uploaded file: {safe_file_name}"
                    )
                else:
                    raise Exception(f"File upload failed with status: {response.request_response.status_code}")
            finally:
                file_stream.close()

        except Exception as e:
            await self._log_activity("upload_file_to_row", sheet_id=sheet_id,
                                    status="error", error_message=str(e), details={"row_id": row_id, "file_name": file_name})
            return await self._handle_api_error(e)

    async def list_sheet_attachments(self, sheet_id: int) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                _SMARTSHEET_EXECUTOR,
                lambda: self._client.Attachments.list_all_attachments(sheet_id)
            )

            if response.request_response.status_code == 200:
                attachments_data = []
                for attachment in response.data:
                    attachments_data.append({
                        "id": attachment.id,
                        "name": attachment.name,
                        "attachment_type": str(attachment.attachment_type),
                        "mime_type": attachment.mime_type,
                        "size_in_kb": attachment.size_in_kb,
                        "parent_type": attachment.parent_type,
                        "parent_id": attachment.parent_id,
                        "created_at": attachment.created_at.isoformat() if attachment.created_at else None,
                        "created_by": self._safe_dict_conversion(attachment.created_by),
                        "url": attachment.url,
                        "url_expires_in_millis": attachment.url_expires_in_millis
                    })

                await self._log_activity("list_sheet_attachments", sheet_id=sheet_id,
                                        details={"attachment_count": len(attachments_data)})

                return SmartsheetResponse(
                    success=True,
                    data={"attachments": attachments_data},
                    message=f"Found {len(attachments_data)} attachments"
                )
            else:
                raise Exception(f"List attachments failed with status: {response.request_response.status_code}")

        except Exception as e:
            await self._log_activity("list_sheet_attachments", sheet_id=sheet_id,
                                    status="error", error_message=str(e))
            return await self._handle_api_error(e)

    async def upload_file_to_sheet(self, sheet_id: int, file_content: bytes,
                                   file_name: str, content_type: str) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            import os
            from io import BytesIO

            safe_file_name = os.path.basename(file_name)
            file_stream = BytesIO(file_content)

            try:
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(
                    _SMARTSHEET_EXECUTOR,
                    lambda: self._client.Attachments.attach_file_to_sheet(
                        sheet_id, (safe_file_name, file_stream, content_type)
                    )
                )

                if response.request_response.status_code == 200:
                    attachment_data = {
                        "id": response.data.id,
                        "name": response.data.name,
                        "attachment_type": str(response.data.attachment_type),
                        "mime_type": response.data.mime_type,
                        "size_in_kb": response.data.size_in_kb,
                        "created_at": response.data.created_at.isoformat() if response.data.created_at else None,
                        "created_by": self._safe_dict_conversion(response.data.created_by)
                    }

                    await self._log_activity("upload_file_to_sheet", sheet_id=sheet_id,
                                            details={"file_name": safe_file_name, "size_kb": response.data.size_in_kb})

                    return SmartsheetResponse(
                        success=True,
                        data={"attachment": attachment_data},
                        message=f"Successfully uploaded file to sheet: {safe_file_name}"
                    )
                else:
                    raise Exception(f"File upload failed with status: {response.request_response.status_code}")
            finally:
                file_stream.close()

        except Exception as e:
            await self._log_activity("upload_file_to_sheet", sheet_id=sheet_id,
                                    status="error", error_message=str(e), details={"file_name": file_name})
            return await self._handle_api_error(e)

    async def upload_file_to_comment(self, sheet_id: int, comment_id: int, file_content: bytes,
                                     file_name: str, content_type: str) -> SmartsheetResponse:
        try:
            await self._rate_limit_check()

            import os
            from io import BytesIO

            safe_file_name = os.path.basename(file_name)
            file_stream = BytesIO(file_content)

            try:
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(
                    _SMARTSHEET_EXECUTOR,
                    lambda: self._client.Attachments.attach_file_to_comment(
                        sheet_id, comment_id, (safe_file_name, file_stream, content_type)
                    )
                )

                if response.request_response.status_code == 200:
                    attachment_data = {
                        "id": response.data.id,
                        "name": response.data.name,
                        "attachment_type": str(response.data.attachment_type),
                        "mime_type": response.data.mime_type,
                        "size_in_kb": response.data.size_in_kb,
                        "created_at": response.data.created_at.isoformat() if response.data.created_at else None,
                        "created_by": self._safe_dict_conversion(response.data.created_by)
                    }

                    await self._log_activity("upload_file_to_comment", sheet_id=sheet_id,
                                            details={"file_name": safe_file_name, "comment_id": comment_id})

                    return SmartsheetResponse(
                        success=True,
                        data={"attachment": attachment_data},
                        message=f"Successfully uploaded file to comment: {safe_file_name}"
                    )
                else:
                    raise Exception(f"File upload failed with status: {response.request_response.status_code}")
            finally:
                file_stream.close()

        except Exception as e:
            await self._log_activity("upload_file_to_comment", sheet_id=sheet_id,
                                    status="error", error_message=str(e), details={"comment_id": comment_id})
            return await self._handle_api_error(e)

# Created and developed by Jai Singh
