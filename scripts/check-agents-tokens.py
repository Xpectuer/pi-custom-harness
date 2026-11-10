#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["tiktoken>=0.7,<1"]
# ///
"""Check AGENTS.md against the project's fixed 2500-token budget."""
import argparse
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path,
                        default=Path(__file__).resolve().parent.parent / "AGENTS.md")
    args = parser.parse_args()
    try:
        import tiktoken
        content = args.path.read_text(encoding="utf-8")
        count = len(tiktoken.get_encoding("cl100k_base").encode_ordinary(content))
    except Exception as exc:
        print(f"无法计数: {exc}", file=sys.stderr)
        print("请使用 uv run <脚本路径> [AGENTS.md路径]；首次运行需联网获取依赖和词表。",
              file=sys.stderr)
        return 2
    print(f"{args.path}: {count} / 2500 tokens (cl100k_base)")
    if count > 2500:
        print("超限：将非核心内容迁至 docs/ 合适目录，在 AGENTS.md 保留摘要和相对链接，再检查。")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
