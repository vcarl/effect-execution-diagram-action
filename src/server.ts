#!/usr/bin/env node
/**
 * Local dev web server for testing the analysis pipeline against GitHub repos.
 *
 * Usage:
 *   npm run serve
 *   # then open http://localhost:3000
 */
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createProjectContext } from "./analysis/project-setup.js";
import { analyzeFlows } from "./analysis/flow-analyzer.js";
import { analyzeErrors } from "./analysis/error-analyzer.js";
import { renderFlowDiagrams } from "./diagrams/flow-diagram.js";
import { renderErrorDiagrams } from "./diagrams/error-diagram.js";

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

interface GitHubCompareFile {
  filename: string;
  status: string;
  raw_url?: string;
}

interface CompareResponse {
  files?: GitHubCompareFile[];
}

async function githubFetch(
  url: string,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "effect-diagram-dev-server",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  const body = await res.json();
  return { status: res.status, body };
}

async function getChangedTsFiles(
  owner: string,
  repo: string,
  base: string,
  head: string,
  token?: string
): Promise<string[]> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
  const { status, body } = await githubFetch(url, token);
  if (status !== 200) {
    throw new Error(
      `GitHub compare API returned ${status} for ${owner}/${repo} ${base}...${head}: ${JSON.stringify(body)}`
    );
  }
  const data = body as CompareResponse;
  return (data.files ?? [])
    .filter(
      (f) =>
        /\.(ts|tsx)$/.test(f.filename) &&
        f.status !== "removed"
    )
    .map((f) => f.filename);
}

async function getFileContent(
  owner: string,
  repo: string,
  filePath: string,
  ref: string,
  token?: string
): Promise<string> {
  // Don't encode the full path — slashes must stay as-is for the GitHub contents API.
  // Encode each path segment individually instead.
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
  const { status, body } = await githubFetch(url, token);
  if (status !== 200) {
    throw new Error(
      `GitHub contents API returned ${status} for ${filePath}: ${JSON.stringify(body)}`
    );
  }
  const data = body as { content?: string; encoding?: string };
  if (data.encoding === "base64" && data.content) {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }
  throw new Error(`Unexpected encoding for ${filePath}: ${data.encoding}`);
}

// ---------------------------------------------------------------------------
// Temp dir + analysis orchestration
// ---------------------------------------------------------------------------

interface AnalyzeRequest {
  owner: string;
  repo: string;
  base: string;
  head: string;
  token?: string;
}

interface DiagramEntry {
  label: string;
  mermaid: string;
  truncated?: boolean;
}

interface AnalyzeResponse {
  files: string[];
  flows?: DiagramEntry[];
  errors?: DiagramEntry[];
}

async function analyze(req: AnalyzeRequest): Promise<AnalyzeResponse> {
  // 1. Get changed files from GitHub
  const changedFiles = await getChangedTsFiles(
    req.owner,
    req.repo,
    req.base,
    req.head,
    req.token
  );

  if (changedFiles.length === 0) {
    return { files: [] };
  }

  // 2. Create temp dir and fetch file contents
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "effect-diagram-"));

  try {
    // Fetch all files in parallel
    const contents = await Promise.all(
      changedFiles.map(async (filePath) => {
        const content = await getFileContent(
          req.owner,
          req.repo,
          filePath,
          req.head,
          req.token
        );
        return { filePath, content };
      })
    );

    // Write files to temp dir
    const writtenPaths: string[] = [];
    for (const { filePath, content } of contents) {
      const fullPath = path.join(tmpDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf-8");
      writtenPaths.push(fullPath);
    }

    // 3. Create a tsconfig in the temp dir
    // Resolve effect from our local node_modules so the TS program
    // can at least see the effect type declarations for AST walking.
    const localNodeModules = path.resolve(__dirname, "..", "node_modules");
    const tsconfigContent = {
      compilerOptions: {
        target: "ES2022",
        module: "Node16",
        moduleResolution: "Node16",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        noEmit: true,
        baseUrl: ".",
        paths: {
          effect: [path.join(localNodeModules, "effect")],
          "effect/*": [path.join(localNodeModules, "effect", "*")],
          "@effect/*": [path.join(localNodeModules, "@effect", "*")],
        },
        typeRoots: [path.join(localNodeModules, "@types")],
      },
      include: ["./**/*.ts", "./**/*.tsx"],
    };
    const tsconfigPath = path.join(tmpDir, "tsconfig.json");
    fs.writeFileSync(
      tsconfigPath,
      JSON.stringify(tsconfigContent, null, 2),
      "utf-8"
    );

    // 4. Run analysis
    const project = createProjectContext(tsconfigPath);

    const flowResult = analyzeFlows(project, writtenPaths);
    const errorResult = analyzeErrors(project, writtenPaths);

    // Post-process: replace temp dir paths with relative repo paths
    const pathMap = new Map<string, string>();
    for (let i = 0; i < writtenPaths.length; i++) {
      pathMap.set(writtenPaths[i], changedFiles[i]);
    }
    for (const node of flowResult.nodes) {
      node.file = pathMap.get(node.file) ?? node.file;
    }
    for (const chain of errorResult.chains) {
      for (const step of chain.steps) {
        step.file = pathMap.get(step.file) ?? step.file;
      }
    }

    const response: AnalyzeResponse = { files: changedFiles };

    if (flowResult.nodes.length > 0) {
      response.flows = renderFlowDiagrams(flowResult);
    }

    if (errorResult.chains.length > 0) {
      response.errors = renderErrorDiagrams(errorResult);
    }

    return response;
  } finally {
    // Clean up temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// HTML page
// ---------------------------------------------------------------------------

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Effect Diagram Dev Server</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; max-width: 1200px; margin: 0 auto; }
    h1 { color: #58a6ff; margin-bottom: 0.5rem; }
    .subtitle { color: #8b949e; margin-bottom: 2rem; }
    form { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; margin-bottom: 2rem; }
    .form-row { display: flex; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .form-group { display: flex; flex-direction: column; flex: 1; min-width: 200px; }
    label { font-size: 0.85rem; color: #8b949e; margin-bottom: 0.3rem; }
    input { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 0.5rem 0.75rem; color: #c9d1d9; font-size: 0.95rem; }
    input:focus { outline: none; border-color: #58a6ff; }
    button { background: #238636; color: white; border: none; border-radius: 6px; padding: 0.6rem 1.5rem; font-size: 1rem; cursor: pointer; font-weight: 600; }
    button:hover { background: #2ea043; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .spinner { display: none; margin-left: 0.5rem; }
    .spinner.active { display: inline-block; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    #results { margin-top: 1rem; }
    .file-list { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem 1.5rem; margin-bottom: 1.5rem; }
    .file-list h3 { color: #58a6ff; margin-bottom: 0.5rem; font-size: 0.95rem; }
    .file-list ul { list-style: none; padding: 0; }
    .file-list li { font-family: monospace; font-size: 0.85rem; padding: 0.15rem 0; color: #8b949e; }
    .diagram-section { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; }
    .diagram-section h3 { color: #58a6ff; margin-bottom: 1rem; }
    .diagram-section h4 { color: #c9d1d9; font-size: 0.9rem; font-family: monospace; margin: 1rem 0 0.5rem; }
    .mermaid { background: #fff; border-radius: 6px; padding: 1rem; }
    .error-msg { background: #3d1a1a; border: 1px solid #f85149; border-radius: 8px; padding: 1rem; color: #f85149; }
    .no-results { color: #8b949e; font-style: italic; }
  </style>
</head>
<body>
  <h1>Effect Diagram Dev Server</h1>
  <p class="subtitle">Analyze Effect-TS code between two branches and generate Mermaid diagrams</p>

  <details id="formDetails" open>
    <summary style="cursor:pointer; color:#58a6ff; font-weight:600; margin-bottom:0.5rem;">Configuration</summary>
    <form id="analyzeForm">
      <div class="form-row">
        <div class="form-group" style="flex: 2">
          <label for="ownerRepo">Repository (owner/repo)</label>
          <input type="text" id="ownerRepo" placeholder="e.g. Effect-TS/effect" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="base">Base branch</label>
          <input type="text" id="base" placeholder="e.g. main" value="main" required>
        </div>
        <div class="form-group">
          <label for="head">Head branch</label>
          <input type="text" id="head" placeholder="e.g. feature-branch" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="token">GitHub Token (optional, for private repos)</label>
          <input type="password" id="token" placeholder="ghp_...">
        </div>
      </div>
      <button type="submit" id="submitBtn">
        Analyze
        <span class="spinner" id="spinner">&#x21bb;</span>
      </button>
    </form>
  </details>

  <div id="results"></div>

  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: false, theme: 'default' });

    const form = document.getElementById('analyzeForm');
    const formDetails = document.getElementById('formDetails');
    const submitBtn = document.getElementById('submitBtn');
    const spinner = document.getElementById('spinner');
    const results = document.getElementById('results');

    // --- URL state ---
    const FIELDS = ['ownerRepo', 'base', 'head', 'token'];

    function loadFromUrl() {
      const params = new URLSearchParams(location.search);
      for (const id of FIELDS) {
        const val = params.get(id);
        if (val) document.getElementById(id).value = val;
      }
    }

    function syncToUrl() {
      const params = new URLSearchParams();
      for (const id of FIELDS) {
        const val = document.getElementById(id).value.trim();
        if (val) params.set(id, val);
      }
      const qs = params.toString();
      history.replaceState(null, '', qs ? '?' + qs : location.pathname);
    }

    loadFromUrl();
    for (const id of FIELDS) {
      document.getElementById(id).addEventListener('input', syncToUrl);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      syncToUrl();
      const ownerRepo = document.getElementById('ownerRepo').value.trim();
      const [owner, repo] = ownerRepo.split('/');
      if (!owner || !repo) {
        results.innerHTML = '<div class="error-msg">Invalid repository format. Use owner/repo.</div>';
        return;
      }

      submitBtn.disabled = true;
      spinner.classList.add('active');
      results.innerHTML = '';

      try {
        const body = {
          owner,
          repo,
          base: document.getElementById('base').value.trim(),
          head: document.getElementById('head').value.trim(),
          token: document.getElementById('token').value.trim() || undefined,
        };

        const res = await fetch('/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (!res.ok) {
          results.innerHTML = '<div class="error-msg">' + escapeHtml(data.error || 'Unknown error') + '</div>';
          return;
        }

        let html = '';

        // File list (collapsed)
        if (data.files && data.files.length > 0) {
          html += '<details class="file-list"><summary><h3 style="display:inline">Analyzed Files (' + data.files.length + ')</h3></summary><ul>';
          for (const f of data.files) {
            html += '<li>' + escapeHtml(f) + '</li>';
          }
          html += '</ul></details>';
        }

        // Flow diagrams
        if (data.flows && data.flows.length > 0) {
          html += '<div class="diagram-section"><h3>Execution Flow</h3>';
          for (const d of data.flows) {
            html += '<h4>' + escapeHtml(d.label) + '</h4>';
            html += '<div class="mermaid">' + escapeHtml(d.mermaid) + '</div>';
            if (d.truncated) html += '<p class="no-results">Diagram was truncated due to size.</p>';
          }
          html += '</div>';
        }

        // Error diagrams
        if (data.errors && data.errors.length > 0) {
          html += '<div class="diagram-section"><h3>Error Channels</h3>';
          for (const d of data.errors) {
            html += '<h4>' + escapeHtml(d.label) + '</h4>';
            html += '<div class="mermaid">' + escapeHtml(d.mermaid) + '</div>';
            if (d.truncated) html += '<p class="no-results">Diagram was truncated due to size.</p>';
          }
          html += '</div>';
        }

        if (!data.flows?.length && !data.errors?.length) {
          if (data.files && data.files.length > 0) {
            html += '<p class="no-results">No Effect-TS patterns (pipe/gen/flatMap/error handling) found in the changed files.</p>';
          } else {
            html += '<p class="no-results">No TypeScript files changed between the two branches.</p>';
          }
        }

        results.innerHTML = html;

        // Render mermaid diagrams
        await mermaid.run({ nodes: results.querySelectorAll('.mermaid') });

        // Collapse form and scroll to results
        formDetails.removeAttribute('open');
        results.scrollIntoView({ behavior: 'smooth' });

      } catch (err) {
        results.innerHTML = '<div class="error-msg">' + escapeHtml(err.message) + '</div>';
      } finally {
        submitBtn.disabled = false;
        spinner.classList.remove('active');
      }
    });

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // Auto-analyze if all required fields are provided via URL
    const allFilled = ['ownerRepo', 'head'].every(id => document.getElementById(id).value.trim());
    if (allFilled) {
      form.requestSubmit();
    }
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3000", 10);

const server = http.createServer(async (req, res) => {
  // GET / — serve the HTML page
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (req.method === "GET" && pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
    return;
  }

  // POST /analyze — run the analysis pipeline
  if (req.method === "POST" && req.url === "/analyze") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    let parsed: AnalyzeRequest;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    if (!parsed.owner || !parsed.repo || !parsed.base || !parsed.head) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Missing required fields: owner, repo, base, head" })
      );
      return;
    }

    try {
      console.log(
        `Analyzing ${parsed.owner}/${parsed.repo} ${parsed.base}...${parsed.head}`
      );
      const result = await analyze(parsed);
      console.log(
        `  → ${result.files.length} files, flows=${result.flows?.length ?? 0}, errors=${result.errors?.length ?? 0}`
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${message}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // 404 for everything else
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`Effect Diagram Dev Server running at http://localhost:${PORT}`);
});
