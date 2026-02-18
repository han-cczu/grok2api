"""Public Chat Completions API (public_key protected)."""

from typing import List, Optional, Union, Dict, Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

from app.core.auth import verify_public_key
from app.core.exceptions import AppException
from app.services.grok.services.chat import ChatService
from app.services.grok.services.model import ModelService

router = APIRouter()


class PublicMessageItem(BaseModel):
    role: str
    content: Union[str, List[Dict[str, Any]]]


class PublicChatRequest(BaseModel):
    model: str = Field(..., description="模型名称")
    messages: List[PublicMessageItem] = Field(..., description="消息数组")
    stream: Optional[bool] = Field(True, description="是否流式输出")


def _text_models() -> list:
    return [
        m
        for m in ModelService.list()
        if not m.is_image and not m.is_image_edit and not m.is_video
    ]


@router.get("/chat/models")
async def public_chat_models():
    """返回可用的文本聊天模型列表"""
    models = _text_models()
    return {
        "object": "list",
        "data": [
            {
                "id": m.model_id,
                "object": "model",
                "display_name": m.display_name,
            }
            for m in models
        ],
    }


@router.post("/chat/completions", dependencies=[Depends(verify_public_key)])
async def public_chat_completions(request: PublicChatRequest):
    """公共文本对话接口"""
    model_info = ModelService.get(request.model)
    if not model_info:
        raise AppException(
            message=f"Model '{request.model}' not found",
            code="model_not_found",
            status_code=404,
        )

    if model_info.is_image or model_info.is_image_edit or model_info.is_video:
        raise AppException(
            message=f"Model '{request.model}' is not a text chat model",
            code="invalid_model",
            status_code=400,
        )

    result = await ChatService.completions(
        model=request.model,
        messages=[msg.model_dump() for msg in request.messages],
        stream=request.stream,
    )

    if isinstance(result, dict):
        return JSONResponse(content=result)

    return StreamingResponse(
        result,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
