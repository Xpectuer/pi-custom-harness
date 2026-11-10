import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * 最小自定义工具集示例。
 *
 * 只启用本文件的工具、关闭内置工具：
 *   pi -e ./examples/custom-tools.ts --no-builtin-tools --no-mcp
 *
 * 只启用指定工具（精确白名单）：
 *   pi -e ./examples/custom-tools.ts --tools custom_ping --no-mcp
 */
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "custom_ping",
    label: "Custom Ping",
    description: "Return a ping acknowledgment. Use this tool when the user asks to ping.",
    promptSnippet: "Ping the harness and return an acknowledgment",
    parameters: Type.Object({
      message: Type.String({ description: "Message to echo back" }),
    }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text" as const, text: `pong: ${params.message}` }],
        details: {},
      };
    },
  });
}
