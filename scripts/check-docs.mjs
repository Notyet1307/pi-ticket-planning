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

function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function requireText(errors, file, text, required, label = required) {
  if (!text.includes(required)) errors.push(`${file}: missing ${label}`);
}

function requirePattern(errors, file, text, pattern, label) {
  if (!pattern.test(text)) errors.push(`${file}: missing ${label}`);
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

function numberedSections(text) {
  return [...text.matchAll(/^## (\d+)\./gm)].map((match) => Number(match[1]));
}

function section(text, number) {
  const start = text.search(new RegExp(`^## ${number}\\.`, "m"));
  if (start < 0) return "";
  const rest = text.slice(start + 1);
  const next = rest.search(/^## \d+\./m);
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
}

export function validateDocs(root) {
  const errors = [];
  const docs = new Map();

  for (const file of ONBOARDING_FILES) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) {
      errors.push(`missing ${file}`);
      continue;
    }
    const text = read(root, file);
    docs.set(file, text);
    checkLocalLinks(root, file, text, errors);
    if (/\/(?:Users|home)\/[A-Za-z0-9._-]+\//.test(text)) errors.push(`${file}: contains a raw local absolute path`);
    for (const phrase of ["empower", "revolutionize", "seamlessly", "end-to-end intelligent ecosystem", "unlock unprecedented productivity", "comprehensive AI-driven solution"]) {
      if (text.toLowerCase().includes(phrase)) errors.push(`${file}: contains promotional phrase ${phrase}`);
    }
  }

  if (errors.some((error) => error.startsWith("missing "))) return errors;

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
      if (expected.some((number) => (cursor = actual.indexOf(number, cursor + 1)) < 0)) errors.push(`${file}: missing ordered guide section 1-11`);
    }
    requireText(errors, enFile, en, "../../README.md#development-and-release-verification", "advanced verification link");
    requireText(errors, zhFile, zh, "../../README.zh-CN.md#开发和发布验证", "高级验证链接");
  }

  for (const [file, links] of [
    ["README.md", GUIDE_PAIRS.map(([en]) => en)],
    ["README.zh-CN.md", GUIDE_PAIRS.map(([, zh]) => zh)],
  ]) {
    for (const link of links) requireText(errors, file, docs.get(file), `](${link})`, `starting-path link ${link}`);
  }

  for (const [file, required] of [
    ["README.md", ["#five-minute-start", "#advanced-mechanisms", "#development-and-release-verification"]],
    ["README.zh-CN.md", ["#五分钟开始", "#高级机制", "#开发和发布验证"]],
  ]) {
    for (const anchor of required) requireText(errors, file, docs.get(file), `(${anchor})`, `navigation link ${anchor}`);
  }

  const enIntro = english.slice(0, english.indexOf("\n## "));
  const zhIntro = chinese.slice(0, chinese.indexOf("\n## "));
  for (const required of ["rough product idea", "feature request", "Issue", "AI agent", "durable output"]) {
    requireText(errors, "README.md", enIntro, required, `first-screen value ${required}`);
  }
  for (const required of ["模糊产品想法", "既有项目", "Issue", "AI", "持久输出"]) {
    requireText(errors, "README.zh-CN.md", zhIntro, required, `首屏价值 ${required}`);
  }
  if (/profile-only|strict[- ]frontier/i.test(enIntro)) errors.push("README.md: first value explanation starts from internal machinery");
  if (/专用 PI Profile|严格前沿/.test(zhIntro)) errors.push("README.zh-CN.md: 首个价值说明从内部机制开始");

  const corpus = [...docs.values()].join("\n");
  if (/every (?:response|turn).{0,40}(?:must|always).{0,40}five[- ]field/is.test(corpus)) errors.push("docs retain an obsolete every-response five-field rule");
  if (/每(?:轮|次|个回复).{0,40}(?:必须|固定).{0,40}五字段/s.test(corpus)) errors.push("文档保留了过时的每轮固定五字段规则");
  for (const file of ["docs/plans/ask-yet-skill-architecture.md", "docs/plans/product-to-delivery-operating-model.md"]) {
    const text = read(root, file);
    if (/(?:固定(?:的)?十四个|十四个(?:只读|全新)[^\n]{0,50}(?:PI|case|场景)|fixed (?:fourteen|14)[^\n]{0,50}(?:PI|case|scenario))/iu.test(text)) {
      errors.push(`${file}: hard-codes the old Release case count`);
    }
  }
  requirePattern(errors, "README.md", english, /what it will not do[\s\S]{0,1200}daemon/i, "explicit non-daemon boundary");
  requirePattern(errors, "README.zh-CN.md", chinese, /它不会做什么[\s\S]{0,1200}daemon/, "明确非 daemon 边界");
  requirePattern(errors, "README.md", english, /merged[\s\S]{0,80}released[\s\S]{0,80}Outcome[\s\S]{0,80}(?:same fact|distinct)/i, "merge/release/outcome separation");
  requirePattern(errors, "README.zh-CN.md", chinese, /merged[\s\S]{0,80}released[\s\S]{0,80}Outcome[\s\S]{0,80}(?:同一事实|不同)/, "merge/release/outcome 区分");

  for (const [file, text] of docs) {
    for (const match of text.matchAll(/\/skill:([a-z][a-z0-9-]*)/g)) {
      if (match[1] !== "ask-yet") errors.push(`${file}: recommends non-entry Skill ${match[1]}`);
    }
  }
  requirePattern(errors, "README.md", english, /model-invoked helper[\s\S]{0,160}(?:advanced )?recovery[\s\S]{0,80}debug/i, "helper boundary");
  requirePattern(errors, "README.zh-CN.md", chinese, /模型调用的 helper[\s\S]{0,160}高级恢复[\s\S]{0,80}调试/, "helper boundary");

  const greenfieldEn = docs.get(GUIDE_PAIRS[0][0]);
  const greenfieldZh = docs.get(GUIDE_PAIRS[0][1]);
  requirePattern(errors, GUIDE_PAIRS[0][0], section(greenfieldEn, 5), /Candidate selection[\s\S]{0,100}not[\s\S]{0,100}Evidence[\s\S]{0,60}Commitment/i, "Candidate selection boundary");
  requirePattern(errors, GUIDE_PAIRS[0][1], section(greenfieldZh, 5), /Candidate selection[\s\S]{0,100}不是[\s\S]{0,100}Commitment/, "Candidate selection boundary");
  for (const required of ["does not initialize Git", "choose a stack", "create application code"]) {
    requireText(errors, GUIDE_PAIRS[0][0], section(greenfieldEn, 1), required, "Greenfield pre-Commitment boundary");
  }
  for (const required of ["不会初始化 Git", "选择技术栈", "创建应用代码"]) {
    requireText(errors, GUIDE_PAIRS[0][1], section(greenfieldZh, 1), required, "Greenfield pre-Commitment boundary");
  }

  for (const [file, text] of [[GUIDE_PAIRS[0][0], greenfieldEn], [GUIDE_PAIRS[0][1], greenfieldZh]]) {
    const splitting = section(text, 7);
    const markers = ["accepted Release", "setup-delivery-repository", "Solution Shaping", "Delivery Spec", "candidate Ticket"];
    let last = -1;
    for (const marker of markers) {
      const index = splitting.toLowerCase().indexOf(marker.toLowerCase());
      if (index < 0 || index < last) {
        errors.push(`${file}: Greenfield post-Commitment order is incomplete`);
        break;
      }
      last = index;
    }
  }

  for (const file of GUIDE_PAIRS[1]) {
    const text = docs.get(file);
    for (const required of file.endsWith("zh-CN.md")
      ? ["AI 是 solution hypothesis", "AI 不是 target outcome", "AI 不是 primary signal"]
      : ["AI is a solution hypothesis", "AI is not the target outcome", "AI is not the primary signal"]) {
      requireText(errors, file, text, required, "AI solution-hypothesis boundary");
    }
  }
  for (const file of GUIDE_PAIRS[2]) {
    const text = docs.get(file);
    requireText(errors, file, text, "Admission", "Admission gate");
    requireText(errors, file, text, file.endsWith("zh-CN.md") ? "Admission 不能绕过" : "Admission cannot be bypassed", "non-bypassable Admission");
  }

  const pkg = JSON.parse(read(root, "package.json"));
  for (const [file, text] of docs) {
    for (const match of text.matchAll(/npm run ([a-z0-9:-]+)/gi)) {
      if (!pkg.scripts?.[match[1]]) errors.push(`${file}: documents missing npm script ${match[1]}`);
    }
    for (const match of text.matchAll(/pi-ticket-plan\s+([^\s`]+)/g)) {
      const command = match[1];
      if (!command.startsWith("-") && !["doctor", "admit"].includes(command)) errors.push(`${file}: documents unsupported launcher command ${command}`);
    }
  }
  const launcher = read(root, "profile/pi-ticket-plan");
  for (const command of ["doctor", "admit"]) {
    if (!launcher.includes(`= "${command}"`)) errors.push(`profile/pi-ticket-plan: missing documented command ${command}`);
  }
  const tag = `v${pkg.version}`;
  for (const file of README_FILES) {
    const text = docs.get(file);
    requireText(errors, file, text, `git clone --branch ${tag} --depth 1`, `release clone ${tag}`);
    requireText(errors, file, text, `git checkout ${tag}`, `release update ${tag}`);
  }

  for (const [pattern, message] of [
    [/automatically (?:makes?|chooses?) (?:the )?Commitment/i, "claims automatic Commitment"],
    [/automatically selects? (?:the )?(?:full )?(?:technology )?stack/i, "claims automatic stack choice"],
    [/自动(?:替[^\n]{0,8})?(?:作出|完成|选择) Commitment/, "声称自动 Commitment"],
    [/自动选择(?:完整)?技术栈/, "声称自动选择技术栈"],
  ]) {
    if (pattern.test(corpus)) errors.push(`docs ${message}`);
  }

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
