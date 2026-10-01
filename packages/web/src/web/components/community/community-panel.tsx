import * as React from "react";
import { ChevronDown, HeartHandshake, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCommunityAccess, useFriends, useResendParentConsent, type ChatChannel } from "@/queries/community";
import { ChatTab, type OpenChannel } from "./chat-tab";
import { FriendsTab } from "./friends-tab";
import { MeetupsTab } from "./meetups-tab";
import { SafetyTab } from "./safety-tab";
import { TeamTab } from "./team-tab";
import { CountDot, ErrorLine, Muted, PENDING_INVITE_KEY, Spinner } from "./shared";

/**
 * Friends, team, chat, meet-ups and the park board, folded into one panel in
 * the play sidebar. Folded, it only polls friend requests (slowly) for the dot.
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

  // Only a light poll while folded, so a new friend request still shows a dot.
  const access = useCommunityAccess(true);
  const friends = useFriends(Boolean(access.data?.community), open ? 20_000 : 90_000);
  const requests = friends.data?.incoming.length ?? 0;

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
        <CountDot count={requests} />
        <ChevronDown
          className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-3">
          <Body
            tab={tab}
            setTab={setTab}
            chat={chat}
            setChat={setChat}
            openChat={openChat}
            zone={zone}
            myPlayerId={myPlayerId}
            requests={requests}
          />
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
  requests,
}: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  chat: OpenChannel | null;
  setChat: (value: OpenChannel | null) => void;
  openChat: (channel: ChatChannel, title: string) => void;
  zone: Zone;
  myPlayerId: string | null;
  requests: number;
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
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "friends" && <CountDot count={requests} />}
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
