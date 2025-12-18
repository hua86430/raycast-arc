/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

type SidebarNode = {
  id?: string;
  title?: string;
  parentID?: string;
  childrenIds?: string[];
  data?: { tab?: { savedURL?: string; savedTitle?: string } };
};

export function normalizeUrl(u: string) {
  // 先只去掉 fragment；不要貿然去 query，避免 console.cloud.google.com 這類 URL 對應不到
  return u.replace(/#.*$/, "");
}

function loadStorableSidebar(): any {
  const p = path.join(os.homedir(), "Library/Application Support/Arc/StorableSidebar.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return null;
  }
}

// StorableSidebar.json 可能是 object map，也可能是 [id, payload, id, payload, ...] 形式
function toEntries(root: any): Array<{ key: string; payload: any }> {
  if (!root) return [];
  if (Array.isArray(root)) {
    const out: Array<{ key: string; payload: any }> = [];
    for (let i = 0; i + 1 < root.length; i += 2) {
      out.push({ key: String(root[i]), payload: root[i + 1] });
    }
    return out;
  }
  if (typeof root === "object") {
    return Object.entries(root).map(([k, v]) => ({ key: k, payload: v }));
  }
  return [];
}

function buildNodeIndex(storableSidebarJson: any): Record<string, SidebarNode> {
  // 你的 snippet 類似是在某個大的 container 裡；這裡做「全域掃描」：遞迴把所有 pair-map 都吃進來
  const index: Record<string, SidebarNode> = {};

  const visit = (obj: any) => {
    if (!obj || typeof obj !== "object") return;

    // 1) 先嘗試把 obj 當成 pair-map 解析
    const entries = toEntries(obj);
    for (const { key, payload } of entries) {
      const value: SidebarNode | undefined = payload?.value ?? payload?.["value"] ?? payload;
      if (value && typeof value === "object") {
        // 判斷是否像一個節點：有 title / parentID / data.tab.savedURL 任一即可
        const looksLikeNode = "title" in value || "parentID" in value || (value as any)?.data?.tab?.savedURL;

        if (looksLikeNode) {
          index[key] = value;
        }
      }
      // payload 可能還有更深層結構
      visit(payload);
    }

    // 2) 也遞迴掃一般 object 的屬性
    if (!Array.isArray(obj)) {
      for (const v of Object.values(obj)) visit(v);
    }
  };

  visit(storableSidebarJson);
  return index;
}

function buildPathById(nodeIndex: Record<string, SidebarNode>, id: string): string {
  const parts: string[] = [];
  let cur = id;
  let guard = 0;

  while (cur && guard++ < 200) {
    const node = nodeIndex[cur];
    if (!node) break;

    if (node.title) parts.push(node.title);

    const parent = node.parentID;
    if (!parent) break;
    cur = parent;
  }

  parts.reverse();
  return parts.join("/");
}

function buildUrlToPaths(nodeIndex: Record<string, SidebarNode>) {
  const map = new Map<string, string[]>();

  for (const [id, node] of Object.entries(nodeIndex)) {
    const savedURL = node?.data?.tab?.savedURL;
    if (!savedURL) continue;

    const u = normalizeUrl(savedURL);
    const p = buildPathById(nodeIndex, id);

    if (!map.has(u)) map.set(u, []);
    map.get(u)!.push(p);
  }

  return map;
}

export function getUrlToPathsMap() {
  const storable = loadStorableSidebar();
  if (!storable) return new Map<string, string[]>();
  const nodeIndex = buildNodeIndex(storable);
  return buildUrlToPaths(nodeIndex);
}
