"""Image Editor public API — 文生图 / 图生图 / 迭代编辑."""

import time
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.core.auth import verify_public_key
from app.core.logger import logger
from app.core.exceptions import AppException, UpstreamException
from app.api.v1.image import resolve_aspect_ratio, SIZE_TO_ASPECT
from app.services.grok.services.image import ImageGenerationService
from app.services.grok.services.image_edit import ImageEditService
from app.services.grok.services.model import ModelService
from app.services.token.manager import get_token_manager

router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class EditorGenerateRequest(BaseModel):
    prompt: str = Field(..., description="图片描述")
    aspect_ratio: str = Field("1:1", description="宽高比: 1:1, 16:9, 9:16, 3:2, 2:3")
    n: int = Field(1, ge=1, le=4, description="生成数量")


class EditorEditRequest(BaseModel):
    prompt: str = Field(..., description="编辑描述")
    image: str = Field(..., description="base64 data URI (data:image/...;base64,...)")
    aspect_ratio: str = Field("1:1", description="宽高比")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

VALID_RATIOS = set(SIZE_TO_ASPECT.values())
RATIO_TO_SIZE = {v: k for k, v in SIZE_TO_ASPECT.items()}


def _normalise_ratio(raw: str) -> str:
    r = (raw or "1:1").strip()
    if r in VALID_RATIOS:
        return r
    return "1:1"


async def _acquire_token(model_id: str):
    token_mgr = await get_token_manager()
    await token_mgr.reload_if_stale()
    token = None
    for pool in ModelService.pool_candidates_for_model(model_id):
        token = token_mgr.get_token(pool)
        if token:
            break
    if not token:
        raise HTTPException(status_code=429, detail="No available tokens. Please try again later.")
    return token_mgr, token


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/editor/models")
async def editor_models():
    """返回可用的图片生成 / 编辑模型."""
    gen_models = [
        {"id": m.model_id, "name": m.model_id, "type": "generate"}
        for m in ModelService.MODELS if m.is_image
    ]
    edit_models = [
        {"id": m.model_id, "name": m.model_id, "type": "edit"}
        for m in ModelService.MODELS if m.is_image_edit
    ]
    return {"models": gen_models + edit_models}


@router.post("/editor/generate", dependencies=[Depends(verify_public_key)])
async def editor_generate(req: EditorGenerateRequest):
    """文生图 — 纯文本提示词生成图片."""
    prompt = (req.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")

    ratio = _normalise_ratio(req.aspect_ratio)
    size = RATIO_TO_SIZE.get(ratio, "1024x1024")

    model_id = "grok-imagine-1.0"
    model_info = ModelService.get(model_id)
    if not model_info or not model_info.is_image:
        raise HTTPException(status_code=500, detail="Image generation model not available")

    token_mgr, token = await _acquire_token(model_id)
    t0 = time.time()

    try:
        result = await ImageGenerationService().generate(
            token_mgr=token_mgr,
            token=token,
            model_info=model_info,
            prompt=prompt,
            n=min(req.n, 4),
            response_format="b64_json",
            size=size,
            aspect_ratio=ratio,
            stream=False,
        )
    except UpstreamException as e:
        raise HTTPException(status_code=502, detail=f"上游服务错误: {e.message}")
    except AppException as e:
        raise HTTPException(status_code=e.status_code or 500, detail=e.message)

    images = [
        img if img.startswith("data:") else f"data:image/png;base64,{img}"
        for img in result.data
        if img and img != "error"
    ]

    if not images:
        raise HTTPException(status_code=502, detail="图片生成返回空结果，请重试")

    elapsed = int((time.time() - t0) * 1000)
    return JSONResponse(content={"images": images, "elapsed_ms": elapsed})


@router.post("/editor/edit", dependencies=[Depends(verify_public_key)])
async def editor_edit(req: EditorEditRequest):
    """图生图 / 迭代编辑 — 基于已有图片 + 提示词生成新图片."""
    prompt = (req.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")

    image_data = (req.image or "").strip()
    if not image_data:
        raise HTTPException(status_code=400, detail="Image data is required")

    # Ensure it's a proper data URI
    if not image_data.startswith("data:"):
        image_data = f"data:image/png;base64,{image_data}"

    model_id = "grok-imagine-1.0-edit"
    model_info = ModelService.get(model_id)
    if not model_info or not model_info.is_image_edit:
        raise HTTPException(status_code=500, detail="Image edit model not available")

    token_mgr, token = await _acquire_token(model_id)
    t0 = time.time()

    try:
        result = await ImageEditService().edit(
            token_mgr=token_mgr,
            token=token,
            model_info=model_info,
            prompt=prompt,
            images=[image_data],
            n=1,
            response_format="b64_json",
            stream=False,
        )
    except UpstreamException as e:
        status = (e.details or {}).get("status") if hasattr(e, "details") else None
        if status == 403:
            logger.warning(f"Image edit upload 403: token may lack upload permission")
            raise HTTPException(
                status_code=502,
                detail="图片上传被 Grok 拒绝 (403)，当前 Token 可能没有上传权限或已过期，请检查 Token 配置",
            )
        raise HTTPException(status_code=502, detail=f"上游服务错误: {e.message}")
    except AppException as e:
        raise HTTPException(status_code=e.status_code or 500, detail=e.message)

    images = [
        img if img.startswith("data:") else f"data:image/png;base64,{img}"
        for img in result.data
        if img and img != "error"
    ]

    if not images:
        raise HTTPException(status_code=502, detail="图片编辑返回空结果，请重试")

    elapsed = int((time.time() - t0) * 1000)
    return JSONResponse(content={"images": images, "elapsed_ms": elapsed})
