import { describe, it, expect } from "vitest";
import { renderErrorDiagram } from "../../src/diagrams/error-diagram.js";
import type { ErrorAnalysisResult } from "../../src/analysis/error-analyzer.js";

describe("error-diagram", () => {
  it("renders error chain with catch nodes as rhombuses", () => {
    const analysis: ErrorAnalysisResult = {
      chains: [
        {
          steps: [
            { id: "e0", label: "fetchUser", errorType: "HttpError", line: 1, file: "test.ts", kind: "operation" },
            { id: "e1", label: "catchTag", errorType: "never", line: 2, file: "test.ts", kind: "catch" },
          ],
          edges: [
            { from: "e0", to: "e1", errorLabel: "HttpError" },
          ],
        },
      ],
    };

    const result = renderErrorDiagram(analysis);
    expect(result.mermaid).toContain("flowchart LR");
    expect(result.mermaid).toContain('e0["fetchUser"]');
    expect(result.mermaid).toContain('e1{"catchTag"}'); // rhombus shape
    expect(result.mermaid).toContain('"E: HttpError"');
  });

  it("renders mapError as parallelogram shape", () => {
    const analysis: ErrorAnalysisResult = {
      chains: [
        {
          steps: [
            { id: "e0", label: "fetchUser", errorType: "HttpError", line: 1, file: "test.ts", kind: "operation" },
            { id: "e1", label: "mapError", errorType: "AppError", line: 2, file: "test.ts", kind: "mapError" },
          ],
          edges: [
            { from: "e0", to: "e1", errorLabel: "HttpError" },
          ],
        },
      ],
    };

    const result = renderErrorDiagram(analysis);
    expect(result.mermaid).toContain('e1[/"mapError"/]'); // parallelogram
  });
});
