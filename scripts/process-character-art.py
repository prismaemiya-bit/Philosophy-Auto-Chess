"""Create deterministic in-game portrait crops from approved full character art.

This is an offline art-preparation helper. It never runs in the web game and
does not alter the source image. Crop coordinates are recorded beside each art
drop so later revisions remain reproducible.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps


def parse_crop(value: str) -> tuple[int, int, int, int]:
    parts = tuple(int(part.strip()) for part in value.split(","))
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("crop must be left,top,right,bottom")
    left, top, right, bottom = parts
    if left < 0 or top < 0 or right <= left or bottom <= top:
        raise argparse.ArgumentTypeError("crop must describe a positive rectangle")
    return left, top, right, bottom


def normalize_framed_art(
    portrait: Image.Image, size: int, padding: int, edge_threshold: int
) -> Image.Image:
    """Remove only edge-connected white canvas and normalize the authored frame.

    The supplied Greek art already owns its pentagonal border. Flood filling from
    the four corners removes the delivery canvas without erasing white robes or
    other light details enclosed by that border. The visible frame is then fitted
    to one deterministic square so every character has the same runtime scale.
    """

    if padding < 0 or padding * 2 >= size:
        raise ValueError("frame padding must leave a positive output area")
    cleaned = portrait.copy()
    corners = (
        (0, 0),
        (cleaned.width - 1, 0),
        (0, cleaned.height - 1),
        (cleaned.width - 1, cleaned.height - 1),
    )
    for corner in corners:
        ImageDraw.floodfill(
            cleaned, corner, (255, 255, 255, 0), thresh=edge_threshold
        )
    if cleaned.getchannel("A").getbbox() is None:
        raise ValueError("edge background removal produced an empty portrait")
    # Keep the complete source canvas. The white canvas is already transparent;
    # cropping the alpha bounds here changes the authored scale differently for
    # each portrait and makes otherwise complete frames look clipped in-game.
    framed = cleaned.resize(
        (size - padding * 2, size - padding * 2), Image.Resampling.LANCZOS
    )
    normalized = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    normalized.alpha_composite(framed, (padding, padding))
    return normalized


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--crop", type=parse_crop, required=True)
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--pentagon-mask", action="store_true")
    parser.add_argument("--framed-art", action="store_true")
    parser.add_argument("--frame-padding", type=int, default=8)
    parser.add_argument("--edge-threshold", type=int, default=42)
    args = parser.parse_args()

    with Image.open(args.source) as source:
        if source.width < args.crop[2] or source.height < args.crop[3]:
            raise ValueError(f"crop {args.crop} exceeds source size {source.size}")
        # ImageOps.exif_transpose keeps future camera-authored sources stable.
        prepared = ImageOps.exif_transpose(source).convert("RGBA")
        portrait = prepared.crop(args.crop).resize(
            (args.size, args.size), Image.Resampling.LANCZOS
        )
        if args.framed_art:
            portrait = normalize_framed_art(
                prepared.crop(args.crop),
                args.size,
                args.frame_padding,
                args.edge_threshold,
            )
        elif args.pentagon_mask:
            scale = 4
            mask = Image.new("L", (args.size * scale, args.size * scale), 0)
            draw = ImageDraw.Draw(mask)
            points = [(0.5, 0.01), (0.98, 0.37), (0.88, 0.98), (0.12, 0.98), (0.02, 0.37)]
            draw.polygon([(round(x * args.size * scale), round(y * args.size * scale)) for x, y in points], fill=255)
            mask = mask.resize((args.size, args.size), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(0.25))
            portrait.putalpha(mask)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    portrait.save(args.out, "WEBP", quality=92, method=6, exact=True)


if __name__ == "__main__":
    main()
