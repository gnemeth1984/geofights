import * as React from "react";
import { ArrowLeft, MessageCircle, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  useChatHistory,
  useChatOverview,
  useMyTeam,
  useSendPreset,
  useSendText,
  type ChatChannel,
} from "@/queries/community";
import { SafetyActions } from "./safety-actions";
import { ErrorLine, Muted, Row, SectionLabel, Spinner } from "./shared";

/**
 * Chat. Everyone with community access gets the ready-made phrases; typed
 * messages are 13+ and only after an account's first day, and every typed line
 * goes through the server filter — contact details, links, addresses and
 * "meet me / where do you live" style requests are refused outright.
 */

export type OpenChannel = { channel: ChatChannel; title: string };

export function ChatTab({
  open,
  setOpen,
  presets,
  freeText,
  freeTextReason,
}: {
  open: OpenChannel | null;
  setOpen: (value: OpenChannel | null) => void;
  presets: Record<string, string>;
  freeText: boolean;
  freeTextReason: string;
}) {
  if (open) {
    return (
      <Conversation
        open={open}
        onBack={() => setOpen(null)}
        presets={presets}
        freeText={freeText}
        freeTextReason={freeTextReason}
      />
    );
  }
  return <Inbox onOpen={setOpen} />;
}

function Inbox({ onOpen }: { onOpen: (value: OpenChannel) => void }) {
  const overview = useChatOverview(true);
  const team = useMyTeam(true);

  return (
    <div className="space-y-1.5">
      <SectionLabel>Conversations</SectionLabel>
      {team.data && (
        <button
          type="button"
          className="w-full text-left"
          onClick={() => onOpen({ channel: { scope: "team", channelId: team.data!.id }, title: `${team.data!.name} team` })}
        >
          <Row>
            <Users className="size-3.5 text-primary" />
            <span className="font-medium">{team.data.name}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">team</span>
          </Row>
        </button>
      )}
      {overview.isLoading && <Spinner />}
      {overview.data?.map((c) => (
        <button
          key={c.friendLinkId}
          type="button"
          className="w-full text-left"
          onClick={() => onOpen({ channel: { scope: "friend", channelId: c.friendLinkId }, title: c.username })}
        >
          <Row>
            <MessageCircle className="size-3.5 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{c.username}</span>
              {c.lastBody && <span className="block truncate text-[11px] text-muted-foreground">{c.lastBody}</span>}
            </span>
          </Row>
        </button>
      ))}
      {overview.data && overview.data.length === 0 && !team.data && (
        <Muted>Add a friend or join a team to start chatting.</Muted>
      )}
      <ErrorLine error={overview.error} />
    </div>
  );
}

function Conversation({
  open,
  onBack,
  presets,
  freeText,
  freeTextReason,
}: {
  open: OpenChannel;
  onBack: () => void;
  presets: Record<string, string>;
  freeText: boolean;
  freeTextReason: string;
}) {
  const history = useChatHistory(open.channel);
  const preset = useSendPreset();
  const text = useSendText();
  const [draft, setDraft] = React.useState("");
  const [note, setNote] = React.useState<string | null>(null);
  const bottom = React.useRef<HTMLDivElement>(null);
  const count = history.data?.length ?? 0;

  React.useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [count]);

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    text.mutate(
      { ...open.channel, body },
      {
        onSuccess: (result) => {
          setDraft("");
          setNote(result.redacted ? "Part of your message was hidden by the filter." : null);
          void history.refetch();
        },
      },
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button size="icon-sm" variant="ghost" aria-label="Back to conversations" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <span className="text-sm font-semibold">{open.title}</span>
      </div>

      <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border bg-background/40 p-2">
        {history.isLoading && <Spinner />}
        {history.data?.length === 0 && <Muted>No messages in the last few days.</Muted>}
        {history.data?.map((m) => (
          <div key={m.id} className={cn("flex items-start gap-1", m.mine && "justify-end")}>
            <div
              className={cn(
                "max-w-[80%] rounded-md px-2 py-1 text-xs",
                m.mine ? "bg-primary/20" : "bg-secondary",
              )}
            >
              {!m.mine && <div className="text-[10px] font-medium text-muted-foreground">{m.username}</div>}
              <div className="break-words">{m.body}</div>
            </div>
            {!m.mine && <SafetyActions playerId={m.authorId} username={m.username} context="chat" refId={m.id} />}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <div className="flex flex-wrap gap-1">
        {Object.entries(presets).map(([id, label]) => (
          <button
            key={id}
            type="button"
            disabled={preset.isPending}
            onClick={() =>
              preset.mutate({ ...open.channel, presetId: id }, { onSuccess: () => void history.refetch() })
            }
            className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-[11px] hover:bg-secondary disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>

      {freeText ? (
        <form onSubmit={send} className="flex gap-1.5">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type a message"
            aria-label="Message"
            maxLength={200}
            autoComplete="off"
          />
          <Button type="submit" size="icon" aria-label="Send" disabled={text.isPending || !draft.trim()}>
            <Send className="size-4" />
          </Button>
        </form>
      ) : (
        <Muted>{freeTextReason}</Muted>
      )}
      {note && <Muted>{note}</Muted>}
      <Muted>Never share your real name, school, address, phone or other apps. Report anyone who asks.</Muted>
      <ErrorLine error={preset.error ?? text.error ?? history.error} />
    </div>
  );
}
