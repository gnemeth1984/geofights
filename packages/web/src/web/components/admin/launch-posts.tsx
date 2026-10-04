import { useEffect, useState } from "react";
import { Check, Copy, Download, ExternalLink, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CHANNELS, type LaunchPost } from "@/lib/launch-kit";
import { relative } from "@/lib/format";
import { useSetLaunchItem } from "@/queries/launch";

export type LaunchItemRow = {
  key: string;
  status: "todo" | "ready" | "posted" | "skipped";
  postedUrl: string | null;
  postedAt: string | Date | null;
  note: string | null;
};

export const STATUS_TONE = { todo: "neutral", ready: "info", posted: "live", skipped: "warn" } as const;

export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  };
  return { copied, copy };
}

/** One ready-to-post item: preview, caption to copy, asset to download, and its progress. */
export function PostCard({ post, item }: { post: LaunchPost; item: LaunchItemRow | undefined }) {
  const save = useSetLaunchItem();
  const { copied, copy } = useCopy();
  const [status, setStatus] = useState<LaunchItemRow["status"]>(item?.status ?? "todo");
  const [url, setUrl] = useState(item?.postedUrl ?? "");

  useEffect(() => {
    setStatus(item?.status ?? "todo");
    setUrl(item?.postedUrl ?? "");
  }, [item?.status, item?.postedUrl]);

  const dirty = status !== (item?.status ?? "todo") || url !== (item?.postedUrl ?? "");
  const badUrl = url.trim() !== "" && !/^https?:\/\/\S+$/.test(url.trim());

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-background">
        {post.assetKind === "image" ? (
          <img src={post.asset} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
        ) : (
          <video
            src={post.asset}
            poster="/press/trailer-poster.jpg"
            className="max-h-full max-w-full"
            controls
            preload="none"
            playsInline
            aria-label={`${post.title} video`}
          >
            <track kind="captions" src="/videos/geofights-trailer.vtt" srcLang="en" label="English" />
          </video>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium" title={post.title}>
            {post.title}
          </p>
          <Badge tone={STATUS_TONE[item?.status ?? "todo"]}>{item?.status ?? "todo"}</Badge>
        </div>
        <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-background p-2 font-sans text-[11px] leading-relaxed text-muted-foreground">
          {post.caption}
        </pre>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => copy("caption", post.caption)}>
            {copied === "caption" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            Caption
          </Button>
          <a href={post.asset} download>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
              <Download className="size-3.5" /> {post.assetKind}
            </Button>
          </a>
          {item?.postedUrl && (
            <a href={item.postedUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                <ExternalLink className="size-3.5" /> live post
              </Button>
            </a>
          )}
        </div>
        <div className="mt-auto flex items-center gap-1.5 border-t border-border pt-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as LaunchItemRow["status"])}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            aria-label={`Status of ${post.title}`}
          >
            <option value="todo">todo</option>
            <option value="ready">ready</option>
            <option value="posted">posted</option>
            <option value="skipped">skipped</option>
          </select>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={`${CHANNELS[post.channel]} post URL`}
            className="h-8 min-w-0 flex-1 text-xs"
          />
          <Button
            size="sm"
            className="h-8 px-2"
            disabled={!dirty || badUrl || save.isPending}
            title="Save"
            onClick={() =>
              save.mutate({ key: post.key, status, postedUrl: url.trim() || null, note: item?.note ?? null })
            }
          >
            <Save className="size-3.5" />
          </Button>
        </div>
        {item?.postedAt && <p className="text-[11px] text-muted-foreground">Posted {relative(item.postedAt)}</p>}
        {badUrl && <p className="text-[11px] text-destructive">Paste the full link, starting with https://</p>}
        {save.error && <p className="text-[11px] text-destructive">Not saved: {save.error.message}</p>}
      </div>
    </div>
  );
}
