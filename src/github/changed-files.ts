import type { GitHub } from "@actions/github/lib/utils.js";

type Octokit = InstanceType<typeof GitHub>;

export async function getChangedFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<string[]> {
  const files: string[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
      page,
    });

    if (data.length === 0) break;

    for (const file of data) {
      if (file.status === "removed") continue;
      if (!/\.(ts|tsx)$/.test(file.filename)) continue;
      files.push(file.filename);
    }

    if (data.length < 100) break;
    page++;
  }

  return files;
}
