/**
 * OpenCode Logger Plugin
 *
 * Port of .claude/hooks/post_tool_use.py
 * Logs every tool use event to logs/post_tool_use.json
 *
 * OpenCode plugin API: export default { hooks: { ... } }
 */

import fs from "fs";
import path from "path";

export default {
  name: "logger",
  version: "1.0.0",
  description:
    "Logs all tool use events to logs/post_tool_use.json (port of Claude Code post_tool_use.py hook)",

  hooks: {
    /**
     * Called after every tool invocation.
     * @param {Object} event - Tool use event from OpenCode
     * @param {string} event.tool   - Tool name (e.g. "bash", "read", "write")
     * @param {Object} event.input  - Tool input parameters
     * @param {Object} event.output - Tool output / result
     * @param {number} event.duration_ms - Execution duration in milliseconds
     */
    afterToolUse(event) {
      try {
        const logDir = path.join(process.cwd(), "logs");
        fs.mkdirSync(logDir, { recursive: true });

        const logPath = path.join(logDir, "post_tool_use.json");

        let logData = [];
        if (fs.existsSync(logPath)) {
          try {
            const raw = fs.readFileSync(logPath, "utf-8");
            logData = JSON.parse(raw);
          } catch {
            logData = [];
          }
        }

        logData.push({
          timestamp: new Date().toISOString(),
          ...event,
        });

        fs.writeFileSync(logPath, JSON.stringify(logData, null, 2), "utf-8");
      } catch {
        // Fail silently — logging should never block agent work
      }
    },
  },
};
