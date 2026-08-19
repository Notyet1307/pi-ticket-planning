import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const README_FILES = ["README.md", "README.zh-CN.md"];
const GUIDE_PAIRS = [
  ["docs/getting-started/greenfield.md", "docs/getting-started/greenfield.zh-CN.md"],
  ["docs/getting-started/brownfield-feature.md", "docs/getting-started/brownfield-feature.zh-CN.md"],
  ["docs/getting-started/existing-issue.md", "docs/getting-started/existing-issue.zh-CN.md"],
];
const GUIDE_FILES = GUIDE_PAIRS.flat();
const ONBOARDING_FILES = [...README_FILES, ...GUIDE_FILES];
const REQUIRED_FILES = [...ONBOARDING_FILES, "AGENTS.md", "CHANGELOG.md", "docs/README.md", "fixtures/README.md"];
const STABLE_TAG = "v0.3.1";

function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function requireText(errors, file, text, required, label = required) {
  if (!text.includes(required)) errors.push(`${file}: missing ${label}`);
}

function markdownTargets(text) {
  return [...text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map((match) => {
    const value = match[1].trim();
    if (value.startsWith("<")) return value.slice(1, value.indexOf(">"));
    return value.split(/\s+/)[0];
  });
}

function headingAnchors(text) {
  return new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1]
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")));
}

function checkLocalLinks(root, file, text, errors) {
  for (const target of markdownTargets(text)) {
    if (!target || /^[a-z][a-z+.-]*:/i.test(target)) continue;
    const hash = target.indexOf("#");
    const fragment = hash < 0 ? "" : target.slice(hash + 1);
    if (target.startsWith("#")) {
      if (fragment && !headingAnchors(text).has(fragment.toLowerCase())) errors.push(`${file}: unresolved heading link ${target}`);
      continue;
    }
    let pathname = target.split(/[?#]/, 1)[0];
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      errors.push(`${file}: invalid encoded link ${target}`);
      continue;
    }
    const resolved = path.resolve(root, path.dirname(file), pathname);
    const relative = path.relative(root, resolved);
    if (path.isAbsolute(pathname) || relative.startsWith("..") || path.isAbsolute(relative)) {
      errors.push(`${file}: local link escapes the repository: ${target}`);
    } else if (!fs.existsSync(resolved)) {
      errors.push(`${file}: unresolved local link ${target}`);
    } else if (fragment && resolved.endsWith(".md") && !headingAnchors(fs.readFileSync(resolved, "utf8")).has(fragment.toLowerCase())) {
      errors.push(`${file}: unresolved heading link ${target}`);
    }
  }
}

function markdownFiles(root) {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) return REQUIRED_FILES.filter((file) => file.endsWith(".md"));
  return result.stdout.trim().split("\n").filter((file) => file && fs.existsSync(path.join(root, file)));
}

function numberedSections(text) {
  return [...text.matchAll(/^## (\d+)\./gm)].map((match) => Number(match[1]));
}

function checkStableTag(root, errors) {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${STABLE_TAG}^{commit}`], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout.trim()) errors.push(`documented stable tag does not exist: ${STABLE_TAG}`);
}

export function validateDocs(root) {
  const errors = [];
  const docs = new Map();

  for (const file of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(root, file))) errors.push(`missing ${file}`);
  }
  if (errors.length > 0) return errors;

  for (const file of ONBOARDING_FILES) {
    const text = read(root, file);
    docs.set(file, text);
    if (/(?:\/Users|\/home)\/[A-Za-z0-9._-]+\//.test(text)) errors.push(`${file}: contains a raw local absolute path`);
  }

  for (const file of markdownFiles(root)) checkLocalLinks(root, file, read(root, file), errors);

  const english = docs.get("README.md");
  const chinese = docs.get("README.zh-CN.md");
  requireText(errors, "README.md", english, "[简体中文](README.zh-CN.md)", "language switch");
  requireText(errors, "README.zh-CN.md", chinese, "[English](README.md)", "language switch");

  for (const [enFile, zhFile] of GUIDE_PAIRS) {
    const en = docs.get(enFile);
    const zh = docs.get(zhFile);
    requireText(errors, enFile, en, `(${path.basename(zhFile)})`, "Chinese language link");
    requireText(errors, zhFile, zh, `(${path.basename(enFile)})`, "English language link");
    const expected = Array.from({ length: 11 }, (_, index) => index + 1);
    for (const [file, text] of [[enFile, en], [zhFile, zh]]) {
      const actual = numberedSections(text);
      let cursor = -1;
      if (expected.some((number) => (cursor = actual.indexOf(number, cursor + 1)) < 0)) {
        errors.push(`${file}: missing ordered guide section 1-11`);
      }
    }
  }

  for (const [file, links] of [
    ["README.md", GUIDE_PAIRS.map(([en]) => en)],
    ["README.zh-CN.md", GUIDE_PAIRS.map(([, zh]) => zh)],
  ]) {
    for (const link of links) requireText(errors, file, docs.get(file), `](${link})`, `starting-path link ${link}`);
  }

  for (const [file, text] of docs) {
    for (const match of text.matchAll(/\/skill:([a-z][a-z0-9-]*)/g)) {
      if (match[1] !== "ask-yet") errors.push(`${file}: recommends non-entry Skill ${match[1]}`);
    }
  }

  const corpus = [...docs.values()].join("\n");
  if (/fixtures?[^.\n]{0,120}\b(?:are|remain)\s+(?:an?\s+)?(?:authoritative|normative|machine contracts?)/i.test(corpus)) {
    errors.push("docs claim fixtures are normative contracts");
  }
  if (/fixtures?[^。\n]{0,120}(?:是|属于)(?:权威|规范|机器合同)/i.test(corpus)) {
    errors.push("文档声称 fixtures 是规范合同");
  }
  if (/(?:main[\s\S]{0,120}(?:same|identical)[\s\S]{0,120}v0\.3\.1|v0\.3\.1[\s\S]{0,120}(?:same|identical)[\s\S]{0,120}main)/i.test(corpus)) {
    errors.push("docs claim main and v0.3.1 have identical behavior");
  }
  if (/(?:main[\s\S]{0,120}(?:相同|一致)[\s\S]{0,120}v0\.3\.1|v0\.3\.1[\s\S]{0,120}(?:相同|一致)[\s\S]{0,120}main)/i.test(corpus)) {
    errors.push("文档声称 main 与 v0.3.1 行为相同");
  }

  const pkg = JSON.parse(read(root, "package.json"));
  for (const [file, text] of docs) {
    for (const match of text.matchAll(/npm run ([a-z0-9:-]+)/gi)) {
      if (!pkg.scripts?.[match[1]]) errors.push(`${file}: documents missing npm script ${match[1]}`);
    }
    for (const match of text.matchAll(/pi-ticket-plan\s+([^\s`]+)/g)) {
      const command = match[1];
      if (!command.startsWith("-") && !["doctor", "admit"].includes(command)) {
        errors.push(`${file}: documents unsupported launcher command ${command}`);
      }
    }
  }

  const launcher = read(root, "profile/pi-ticket-plan");
  for (const command of ["doctor", "admit"]) {
    if (!launcher.includes(`= "${command}"`)) errors.push(`profile/pi-ticket-plan: missing documented command ${command}`);
  }

  for (const file of README_FILES) {
    const text = docs.get(file);
    requireText(errors, file, text, "git clone --branch main --depth 1", "current-development clone");
    requireText(errors, file, text, `git clone --branch ${STABLE_TAG} --depth 1`, `stable clone ${STABLE_TAG}`);
  }
  checkStableTag(root, errors);

  return errors;
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  const root = path.resolve(path.dirname(ownPath), "..");
  const errors = validateDocs(root);
  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR ${error}`);
    process.exitCode = 1;
  } else {
    console.log("docs: ok");
  }
}
