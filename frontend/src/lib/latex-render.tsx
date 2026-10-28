import type * as Ast from "@unified-latex/unified-latex-types";
import { parse } from "@unified-latex/unified-latex-util-parse";
import katex from "katex";
import { Fragment, type ReactNode } from "react";

export interface LatexWarning {
  line: number;
  message: string;
}

const SECTIONS: Record<string, number> = { section: 0, subsection: 1, subsubsection: 2 };
const MATH_ENVS = new Set(["equation", "align", "gather", "multline", "alignat", "flalign", "eqnarray"].flatMap((e) => [e, `${e}*`]));
const RAW_ENVS = new Set(["verbatim", "verbatim*", "lstlisting", "minted"]);
const SILENT_MACROS = new Set([
  "documentclass",
  "usepackage",
  "label",
  "newpage",
  "clearpage",
  "noindent",
  "centering",
  "vspace",
  "hspace",
  "bigskip",
  "medskip",
  "smallskip",
  "vfill",
  "hfill",
  "tableofcontents",
  "pagebreak",
  "linebreak",
  "indent",
  "hline",
  "small",
  "large",
  "Large",
  "normalsize",
  "footnotesize",
]);
const ESCAPED = new Set(["%", "&", "$", "#", "_", "{", "}"]);
const SYMBOLS: Record<string, string> = {
  ldots: "…",
  dots: "…",
  LaTeX: "LaTeX",
  TeX: "TeX",
  quad: " ",
  qquad: "  ",
  ",": " ",
  ";": " ",
  " ": " ",
  textbackslash: "\\",
  textendash: "–",
  textemdash: "—",
  copyright: "©",
  S: "§",
};
const KATEX_CACHE_MAX = 500;
const katexCache = new Map<string, { html: string } | { error: string }>();

function renderMath(tex: string, display: boolean) {
  const key = `${display ? "D" : "I"}${tex}`;
  const hit = katexCache.get(key);
  if (hit) return hit;
  let out: { html: string } | { error: string };
  try {
    out = { html: katex.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: "ignore", output: "html" }) };
  } catch (err) {
    out = { error: err instanceof Error ? err.message.replace(/^KaTeX parse error: /, "") : "Công thức không hợp lệ" };
  }
  if (katexCache.size >= KATEX_CACHE_MAX) katexCache.delete(katexCache.keys().next().value!);
  katexCache.set(key, out);
  return out;
}

function safeUrl(url: string) {
  return /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : null;
}

function typography(s: string) {
  return s.replace(/---/g, "—").replace(/--/g, "–").replace(/``/g, "“").replace(/''/g, "”").replace(/~/g, " ");
}

function raw(nodes: Ast.Node[]): string {
  return nodes
    .map((n) => {
      if (n.type === "string") return n.content;
      if (n.type === "whitespace") return " ";
      if (n.type === "group") return `{${raw(n.content)}}`;
      if (n.type === "macro") return `\\${n.content}${(n.args ?? []).map((a) => `${a.openMark}${raw(a.content)}${a.closeMark}`).join("")}`;
      return "";
    })
    .join("");
}

function trimWhitespace(nodes: Ast.Node[]) {
  let start = 0;
  let end = nodes.length;
  while (start < end && nodes[start]!.type === "whitespace") start++;
  while (end > start && nodes[end - 1]!.type === "whitespace") end--;
  return nodes.slice(start, end);
}

const isBlank = (nodes: Ast.Node[]) => nodes.every((n) => n.type === "whitespace" || n.type === "parbreak" || n.type === "comment");

function lastArg(m: Ast.Macro) {
  const args = (m.args ?? []).filter((a) => a.openMark === "{");
  return args[args.length - 1]?.content ?? [];
}

function bracedArg(m: Ast.Macro, i: number) {
  return (m.args ?? []).filter((a) => a.openMark === "{")[i]?.content ?? [];
}

function optionalArg(m: Ast.Macro) {
  return (m.args ?? []).find((a) => a.openMark === "[")?.content ?? null;
}

class Renderer {
  warnings: LatexWarning[] = [];
  private counters = [0, 0, 0];
  private meta: { title?: Ast.Node[]; author?: Ast.Node[]; date?: Ast.Node[] } = {};
  private key = 0;

  constructor(private readonly source: string) {}

  private k() {
    return this.key++;
  }

  private line(n: Ast.Node) {
    return n.position?.start.line ?? 0;
  }

  private warn(n: Ast.Node, message: string) {
    if (this.warnings.length < 200) this.warnings.push({ line: this.line(n), message });
  }

  private slice(n: Ast.Node) {
    const p = n.position;
    return p ? this.source.slice(p.start.offset, p.end.offset) : "";
  }

  private math(n: Ast.Node, tex: string, display: boolean): ReactNode {
    const out = renderMath(tex, display);
    if ("error" in out) {
      this.warn(n, `Công thức lỗi: ${out.error}`);
      return display ? (
        <pre key={this.k()} className="latex-math-error">
          {tex}
        </pre>
      ) : (
        <code key={this.k()} className="latex-math-error">
          {tex}
        </code>
      );
    }
    return display ? <div key={this.k()} className="latex-display" dangerouslySetInnerHTML={{ __html: out.html }} /> : <span key={this.k()} dangerouslySetInnerHTML={{ __html: out.html }} />;
  }

  collectMeta(nodes: Ast.Node[]) {
    for (const n of nodes) {
      if (n.type === "macro" && (n.content === "title" || n.content === "author" || n.content === "date")) this.meta[n.content] = lastArg(n);
    }
  }

  blocks(nodes: Ast.Node[]): ReactNode[] {
    const out: ReactNode[] = [];
    let inline: Ast.Node[] = [];
    const flush = () => {
      if (!isBlank(inline)) out.push(<p key={this.k()}>{this.inlines(trimWhitespace(inline))}</p>);
      inline = [];
    };
    for (const n of nodes) {
      if (n.type === "parbreak") {
        flush();
      } else if (n.type === "macro" && n.content in SECTIONS) {
        flush();
        out.push(this.heading(n));
      } else if (n.type === "macro" && (n.content === "title" || n.content === "author" || n.content === "date")) {
        this.meta[n.content] = lastArg(n);
      } else if (n.type === "macro" && n.content === "maketitle") {
        flush();
        out.push(this.titleBlock());
      } else if (n.type === "macro" && n.content === "caption") {
        flush();
        out.push(
          <p key={this.k()} className="latex-caption">
            {this.inlines(lastArg(n))}
          </p>,
        );
      } else if (n.type === "macro" && n.content === "paragraph") {
        flush();
        inline.push(n);
      } else if (n.type === "environment" || n.type === "mathenv") {
        flush();
        out.push(this.environment(n));
      } else if (n.type === "displaymath") {
        flush();
        out.push(this.math(n, this.slice(n).replace(/^\\\[|^\$\$/, "").replace(/\\\]$|\$\$$/, ""), true));
      } else if (n.type === "verbatim") {
        flush();
        out.push(<pre key={this.k()}>{n.content.replace(/^\n/, "")}</pre>);
      } else {
        inline.push(n);
      }
    }
    flush();
    return out;
  }

  private heading(m: Ast.Macro): ReactNode {
    const level = SECTIONS[m.content]!;
    const first = (m.args ?? [])[0];
    const starred = first?.openMark === "*" || raw(first?.content ?? []) === "*";
    let number = "";
    if (!starred) {
      this.counters[level]!++;
      for (let i = level + 1; i < this.counters.length; i++) this.counters[i] = 0;
      number = this.counters.slice(0, level + 1).join(".");
    }
    const Tag = (["h2", "h3", "h4"] as const)[level]!;
    return (
      <Tag key={this.k()}>
        {number ? <span className="latex-number">{number}</span> : null}
        {this.inlines(lastArg(m))}
      </Tag>
    );
  }

  private titleBlock(): ReactNode {
    const { title, author, date } = this.meta;
    if (!title) return null;
    return (
      <header key={this.k()} className="latex-title">
        <h1>{this.inlines(title)}</h1>
        {author ? <p>{this.inlines(author)}</p> : null}
        <p>{date ? this.inlines(date) : new Intl.DateTimeFormat("vi-VN", { dateStyle: "long" }).format(new Date())}</p>
      </header>
    );
  }

  private environment(n: Ast.Environment): ReactNode {
    const env = n.env;
    if (n.type === "mathenv" || MATH_ENVS.has(env)) return this.math(n, this.slice(n), true);
    if (RAW_ENVS.has(env)) {
      const body = this.slice(n)
        .replace(/^\\begin\{[^}]*\}(\[[^\]]*\])?(\{[^}]*\})?/, "")
        .replace(/\\end\{[^}]*\}$/, "")
        .replace(/^\n/, "");
      return <pre key={this.k()}>{body}</pre>;
    }
    switch (env) {
      case "document":
        return <Fragment key={this.k()}>{this.blocks(n.content)}</Fragment>;
      case "itemize":
      case "enumerate":
        return this.list(n, env === "itemize" ? "ul" : "ol");
      case "description":
        return this.description(n);
      case "tabular":
      case "tabular*":
      case "tabularx":
        return this.tabular(n);
      case "center":
        return (
          <div key={this.k()} className="latex-center">
            {this.blocks(n.content)}
          </div>
        );
      case "flushright":
        return (
          <div key={this.k()} className="text-right">
            {this.blocks(n.content)}
          </div>
        );
      case "flushleft":
        return <div key={this.k()}>{this.blocks(n.content)}</div>;
      case "quote":
      case "quotation":
        return <blockquote key={this.k()}>{this.blocks(n.content)}</blockquote>;
      case "abstract":
        return (
          <section key={this.k()} className="latex-abstract">
            <p className="latex-abstract-title">Tóm tắt</p>
            {this.blocks(n.content)}
          </section>
        );
      case "figure":
      case "figure*":
      case "table":
      case "table*":
        return (
          <figure key={this.k()} className="latex-figure">
            {this.blocks(n.content)}
          </figure>
        );
      case "theorem":
      case "lemma":
      case "proof":
      case "definition":
      case "remark":
      case "example": {
        const label = { theorem: "Định lý", lemma: "Bổ đề", proof: "Chứng minh", definition: "Định nghĩa", remark: "Nhận xét", example: "Ví dụ" }[env];
        return (
          <div key={this.k()} className="latex-theorem">
            <p>
              <strong>{label}.</strong>
            </p>
            {this.blocks(n.content)}
          </div>
        );
      }
      default:
        this.warn(n, `Môi trường «${env}» chưa được hỗ trợ trong bản xem trước`);
        return <div key={this.k()}>{this.blocks(n.content)}</div>;
    }
  }

  private items(n: Ast.Environment) {
    return n.content.filter((c): c is Ast.Macro => c.type === "macro" && c.content === "item");
  }

  private list(n: Ast.Environment, Tag: "ul" | "ol"): ReactNode {
    return (
      <Tag key={this.k()}>
        {this.items(n).map((item) => {
          const label = optionalArg(item);
          const body = item.args?.[item.args.length - 1]?.content ?? [];
          return (
            <li key={this.k()} className={label ? "latex-labelled" : undefined}>
              {label ? <strong className="latex-item-label">{this.inlines(label)} </strong> : null}
              {this.blocks(body)}
            </li>
          );
        })}
      </Tag>
    );
  }

  private description(n: Ast.Environment): ReactNode {
    return (
      <dl key={this.k()} className="latex-description">
        {this.items(n).map((item) => (
          <Fragment key={this.k()}>
            <dt>{this.inlines(optionalArg(item) ?? [])}</dt>
            <dd>{this.blocks(item.args?.[item.args.length - 1]?.content ?? [])}</dd>
          </Fragment>
        ))}
      </dl>
    );
  }

  private tabular(n: Ast.Environment): ReactNode {
    const spec = raw(n.args?.filter((a) => a.openMark === "{").pop()?.content ?? []);
    const aligns = [...spec.replace(/\{[^}]*\}/g, "")].filter((c) => "lcrpXmb".includes(c)).map((c) => (c === "c" ? "center" : c === "r" ? "right" : "left"));
    const rows: Ast.Node[][][] = [[[]]];
    for (const c of n.content) {
      const row = rows[rows.length - 1]!;
      if (c.type === "macro" && (c.content === "\\" || c.content === "tabularnewline")) rows.push([[]]);
      else if (c.type === "string" && c.content === "&") row.push([]);
      else if (c.type === "macro" && (c.content === "hline" || c.content === "toprule" || c.content === "midrule" || c.content === "bottomrule" || c.content === "cline")) continue;
      else row[row.length - 1]!.push(c);
    }
    const body = rows.filter((r) => r.some((cell) => !isBlank(cell)));
    return (
      <div key={this.k()} className="tableWrapper">
        <table>
          <tbody>
            {body.map((r) => (
              <tr key={this.k()}>
                {r.map((cell, i) => (
                  <td key={i} style={{ textAlign: (aligns[i] ?? "left") as "left" | "center" | "right" }}>
                    {this.inlines(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  inlines(nodes: Ast.Node[]): ReactNode[] {
    const out: ReactNode[] = [];
    let text = "";
    const flushText = () => {
      if (text) out.push(typography(text));
      text = "";
    };
    for (const n of nodes) {
      if (n.type === "string" || n.type === "whitespace") {
        text += n.type === "string" ? n.content : " ";
        continue;
      }
      flushText();
      switch (n.type) {
        case "parbreak":
          out.push(<br key={this.k()} />);
          break;
        case "group":
          out.push(<Fragment key={this.k()}>{this.inlines(n.content)}</Fragment>);
          break;
        case "inlinemath":
          out.push(this.math(n, this.slice(n).replace(/^\$|^\\\(/, "").replace(/\$$|\\\)$/, ""), false));
          break;
        case "displaymath":
        case "environment":
        case "mathenv":
          out.push(<Fragment key={this.k()}>{this.blocks([n])}</Fragment>);
          break;
        case "verb":
          out.push(<code key={this.k()}>{n.content}</code>);
          break;
        case "verbatim":
          out.push(<code key={this.k()}>{n.content}</code>);
          break;
        case "macro":
          out.push(this.macro(n));
          break;
        default:
          break;
      }
    }
    flushText();
    return out;
  }

  private macro(m: Ast.Macro): ReactNode {
    const name = m.content;
    if (ESCAPED.has(name)) return name;
    if (name in SYMBOLS) return SYMBOLS[name];
    if (SILENT_MACROS.has(name)) return null;
    const k = this.k();
    switch (name) {
      case "\\":
      case "newline":
        return <br key={k} />;
      case "textbf":
        return <strong key={k}>{this.inlines(lastArg(m))}</strong>;
      case "textit":
      case "emph":
        return <em key={k}>{this.inlines(lastArg(m))}</em>;
      case "texttt":
        return <code key={k}>{this.inlines(lastArg(m))}</code>;
      case "underline":
        return <u key={k}>{this.inlines(lastArg(m))}</u>;
      case "textsc":
        return (
          <span key={k} className="[font-variant:small-caps]">
            {this.inlines(lastArg(m))}
          </span>
        );
      case "textsuperscript":
        return <sup key={k}>{this.inlines(lastArg(m))}</sup>;
      case "textsubscript":
        return <sub key={k}>{this.inlines(lastArg(m))}</sub>;
      case "today":
        return new Intl.DateTimeFormat("vi-VN", { dateStyle: "long" }).format(new Date());
      case "paragraph":
        return <strong key={k}>{this.inlines(lastArg(m))} </strong>;
      case "footnote":
        return (
          <span key={k} className="latex-footnote">
            ({this.inlines(lastArg(m))})
          </span>
        );
      case "url": {
        const url = raw(lastArg(m));
        const href = safeUrl(url);
        return href ? (
          <a key={k} href={href} target="_blank" rel="noreferrer noopener">
            {url}
          </a>
        ) : (
          url
        );
      }
      case "href": {
        const href = safeUrl(raw(bracedArg(m, 0)));
        const label = this.inlines(bracedArg(m, 1));
        return href ? (
          <a key={k} href={href} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        ) : (
          <Fragment key={k}>{label}</Fragment>
        );
      }
      case "ref":
      case "eqref":
      case "cite":
        return (
          <span key={k} className="latex-ref">
            [{raw(lastArg(m))}]
          </span>
        );
      default: {
        this.warn(m, `Lệnh \\${name} chưa được hỗ trợ trong bản xem trước`);
        return <Fragment key={k}>{this.inlines(lastArg(m))}</Fragment>;
      }
    }
  }
}

export function renderLatex(source: string): { body: ReactNode; warnings: LatexWarning[] } {
  let root: Ast.Root;
  try {
    root = parse(source);
  } catch (err) {
    return { body: null, warnings: [{ line: 0, message: err instanceof Error ? err.message : "Không đọc được mã LaTeX" }] };
  }
  const r = new Renderer(source);
  const docIndex = root.content.findIndex((n) => n.type === "environment" && n.env === "document");
  if (docIndex >= 0) {
    r.collectMeta(root.content.slice(0, docIndex));
    const doc = root.content[docIndex] as Ast.Environment;
    return { body: r.blocks(doc.content), warnings: r.warnings };
  }
  return { body: r.blocks(root.content), warnings: r.warnings };
}
