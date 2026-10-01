import * as React from "react";
import { ChevronDown, HeartHandshake, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCommunityAccess, useResendParentConsent, type ChatChannel } from "@/queries/community";
import { ChatTab, type OpenChannel } from "./chat-tab";
import { FriendsTab } from "./friends-tab";
import { MeetupsTab } from "./meetups-tab";
import { SafetyTab } from "./safety-tab";
import { TeamTab } from "./team-tab";
import { ErrorLine, Muted, PENDING_INVITE_KEY, Spinner } from "./shared";

/**
 * Friends, team, chat, meet-ups and the park board, folded into one panel in
 * the play sidebar. Like the market, nothing in here polls until it is opened.
 */

type Tab = "friends" | "team" | "chat" | "meetups" | "safety";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "friends", label: "Friends" },
  { id: "team", label: "Team" },
  { id: "chat", label: "Chat" },
  { id: "meetups", label: "Parks" },
  { id: "safety", label: "Safety" },
];

type Zone = { id: string; name: string } | null;

export function CommunityPanel({ zone, myPlayerId }: { zone: Zone; myPlayerId: string | null }) {
  const [open, setOpen] = React.useState(() => {
    try {
      // A scanned friend code is waiting: open straight onto it.
      return Boolean(window.localStorage.getItem(PENDING_INVITE_KEY));
    } catch {
      return false;
    }
  });
  const [tab, setTab] = React.useState<Tab>("friends");
  const [chat, setChat] = React.useState<OpenChannel | null>(null);

  const openChat = (channel: ChatChannel, title: string) => {
    setChat({ channel, title });
    setTab("chat");
  };

  return (
    <div className="rounded-lg border border-border bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <HeartHandshake className="size-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Community
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">friends · team · parks</span>
        <ChevronDown
          className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-3">
          <Body tab={tab} setTab={setTab} chat={chat} setChat={setChat} openChat={openChat} zone={zone} myPlayerId={myPlayerId} />
        </div>
      )}
    </div>
  );
}

function Body({
  tab,
  setTab,
  chat,
  setChat,
  openChat,
  zone,
  myPlayerId,
}: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  chat: OpenChannel | null;
  setChat: (value: OpenChannel | null) => void;
  openChat: (channel: ChatChannel, title: string) => void;
  zone: Zone;
  myPlayerId: string | null;
}) {
  const access = useCommunityAccess(true);
  if (access.isLoading) return <Spinner />;
  if (!access.data) return <ErrorLine error={access.error ?? new Error("Could not load community.")} />;
  const a = access.data;
  const minor = a.tier === "minor";

  if (!a.community) {
    return (
      <div className="space-y-3">
        <p className="text-xs leading-relaxed">{a.blockedBy ?? "Community is not available on this account."}</p>
        {a.consent.required && a.consent.status !== "verified" && <ParentConsentStatus consent={a.consent} />}
        <Muted>Solo training and the AR view still work.</Muted>
        <SafetyTab ageBand={a.ageBand} minor={minor} />
      </div>
    );
  }

  const freeTextReason =
    a.ageBand === "under13"
      ? "Under 13, chat is the ready-made phrases above."
      : a.newAccount
        ? "Typed messages unlock after your first day."
        : "Typed messages are off for this account.";

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {TABS.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={tab === t.id ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      {tab === "friends" && <FriendsTab onChat={openChat} />}
      {tab === "team" && <TeamTab canHost={a.host} myPlayerId={myPlayerId} onChat={openChat} />}
      {tab === "chat" && (
        <ChatTab
          open={chat}
          setOpen={setChat}
          presets={a.presets}
          freeText={a.freeText}
          freeTextReason={freeTextReason}
        />
      )}
      {tab === "meetups" && <MeetupsTab zone={zone} canHost={a.host} minor={minor} myPlayerId={myPlayerId} />}
      {tab === "safety" && <SafetyTab ageBand={a.ageBand} minor={minor} />}
    </>
  );
}

function ParentConsentStatus({
  consent,
}: {
  consent: { status: string; parentEmail: string | null };
}) {
  const resend = useResendParentConsent();
  const [email, setEmail] = React.useState(consent.parentEmail ?? "");
  const [sent, setSent] = React.useState(false);

  return (
    <form
      className="space-y-1.5 rounded-md border border-accent/40 bg-accent/10 p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        resend.mutate({ parentEmail: email.trim() }, { onSuccess: () => setSent(true) });
      }}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Mail className="size-3.5" /> Waiting for a parent
      </div>
      <Muted>
        {consent.status === "expired"
          ? "The last link ran out. Send a new one."
          : `We asked ${consent.parentEmail ?? "your parent"} to confirm. Ask them to check their inbox.`}
      </Muted>
      <div className="flex gap-1.5">
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Parent's email"
          aria-label="Parent's email"
        />
        <Button type="submit" size="sm" variant="outline" disabled={resend.isPending || !email.includes("@")}>
          Resend
        </Button>
      </div>
      {sent && <p className="text-xs text-primary">Sent again.</p>}
      <ErrorLine error={resend.error} />
    </form>
  );
}
