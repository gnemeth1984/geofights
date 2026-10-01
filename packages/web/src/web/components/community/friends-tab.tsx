import * as React from "react";
import { Check, Copy, MessageCircle, Share2, UserMinus, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useFriends,
  useMyInvite,
  useRedeemInvite,
  useRemoveFriend,
  useRespondFriend,
  type ChatChannel,
} from "@/queries/community";
import { SafetyActions } from "./safety-actions";
import { ConfirmButton, ErrorLine, Muted, PENDING_INVITE_KEY, Row, SectionLabel, Spinner, shortAgo } from "./shared";

/**
 * Friends, by code only. There is no search box and no "people near you":
 * the only way to add someone is to be given their code or scan their QR,
 * which in practice means being next to them or being sent it by someone who
 * was. Adults and under-18s cannot add each other at all — the server refuses
 * the code, and says so.
 */

export function FriendsTab({ onChat }: { onChat: (channel: ChatChannel, title: string) => void }) {
  const friends = useFriends(true);
  const remove = useRemoveFriend();
  const respond = useRespondFriend();
  const data = friends.data;

  return (
    <div className="space-y-4">
      <InviteCard />
      <AddByCode />

      {data && data.incoming.length > 0 && (
        <div className="space-y-1.5">
          <SectionLabel>Friend requests</SectionLabel>
          {data.incoming.map((req) => (
            <Row key={req.friendLinkId}>
              <span className="truncate font-medium">{req.username}</span>
              <span className="ml-auto inline-flex items-center gap-1">
                <Button
                  size="sm"
                  disabled={respond.isPending}
                  onClick={() => respond.mutate({ friendLinkId: req.friendLinkId, accept: true })}
                >
                  <Check className="size-3.5" /> Accept
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Decline ${req.username}`}
                  disabled={respond.isPending}
                  onClick={() => respond.mutate({ friendLinkId: req.friendLinkId, accept: false })}
                >
                  <X className="size-3.5" />
                </Button>
                <SafetyActions playerId={req.playerId} username={req.username} context="profile" />
              </span>
            </Row>
          ))}
          <Muted>Only accept people you know in real life.</Muted>
        </div>
      )}

      <div className="space-y-1.5">
        <SectionLabel>Friends</SectionLabel>
        {friends.isLoading && <Spinner />}
        {data && data.friends.length === 0 && <div className="rounded-md border border-dashed border-border p-3 text-center text-[11px] leading-relaxed text-muted-foreground">
            No friends yet. Next time you're at the park with someone you know, scan each other's QR.
          </div>}
        {data?.friends.map((f) => (
          <Row key={f.friendLinkId}>
            <span className="min-w-0">
              <span className="block truncate font-medium">{f.username}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                lvl {f.level} · {f.wins} wins
                {f.lastSeenAt && <> · {onlineLabel(f.lastSeenAt)}</>}
              </span>
            </span>
            <span className="ml-auto inline-flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Chat with ${f.username}`}
                onClick={() => onChat({ scope: "friend", channelId: f.friendLinkId }, f.username)}
              >
                <MessageCircle className="size-3.5" />
              </Button>
              <ConfirmButton
                ariaLabel={`Remove ${f.username} as a friend`}
                confirmLabel="Remove?"
                icon={<UserMinus className="size-3.5" />}
                disabled={remove.isPending}
                onConfirm={() => remove.mutate({ playerId: f.playerId })}
              />
              <SafetyActions playerId={f.playerId} username={f.username} context="profile" />
            </span>
          </Row>
        ))}
      </div>

      {data && data.outgoing.length > 0 && (
        <div className="space-y-1.5">
          <SectionLabel>Waiting for them</SectionLabel>
          {data.outgoing.map((req) => (
            <Row key={req.friendLinkId}>
              <span className="truncate">{req.username}</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">pending</span>
            </Row>
          ))}
        </div>
      )}
      <ErrorLine error={friends.error ?? remove.error ?? respond.error} />
    </div>
  );
}

function onlineLabel(at: string | Date) {
  const ago = shortAgo(at);
  return ago === "now" || (ago.endsWith("m") && Number.parseInt(ago, 10) < 10) ? "online" : `seen ${ago} ago`;
}

function InviteCard() {
  const invite = useMyInvite(true);
  const [qr, setQr] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const url = invite.data ? new URL(invite.data.link, window.location.origin).toString() : null;

  React.useEffect(() => {
    if (!url) return;
    let live = true;
    // Loaded on demand — the play bundle does not carry a QR encoder for a
    // panel most sessions never open.
    import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: "#0b0f0c", light: "#ffffff" } }),
      )
      .then((data) => live && setQr(data))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [url]);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      /* clipboard blocked — the code is on screen anyway */
    }
  };
  const share = async () => {
    if (!url || !navigator.share) return void copy();
    await navigator.share({ title: "Add me on GeoFights", url }).catch(() => undefined);
  };

  return (
    <div className="space-y-2">
      <SectionLabel>Your friend code</SectionLabel>
      {invite.isLoading && <Spinner />}
      {invite.data && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-background/50 p-2.5">
          {qr ? (
            <img src={qr} alt={`QR code for friend code ${invite.data.code}`} className="size-24 rounded bg-white p-1" />
          ) : (
            <div className="size-24 rounded bg-secondary" />
          )}
          <div className="min-w-0 space-y-1.5">
            <div className="font-mono text-lg font-semibold tracking-[0.2em]">{invite.data.code}</div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => void copy()}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void share()}>
                <Share2 className="size-3.5" /> Share
              </Button>
            </div>
          </div>
        </div>
      )}
      <Muted>Show this to a friend in person so they can scan it. Do not post it publicly.</Muted>
      <ErrorLine error={invite.error} />
    </div>
  );
}

function AddByCode() {
  const redeem = useRedeemInvite();
  const [code, setCode] = React.useState(() => {
    try {
      return window.localStorage.getItem(PENDING_INVITE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [note, setNote] = React.useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = code.trim().toUpperCase();
    if (value.length < 6) return;
    redeem.mutate(
      { code: value },
      {
        onSuccess: (result) => {
          setCode("");
          try {
            window.localStorage.removeItem(PENDING_INVITE_KEY);
          } catch {
            /* ignore */
          }
          setNote(
            result.status === "accepted"
              ? `You and ${result.username} are now friends.`
              : `Request sent to ${result.username}.`,
          );
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-1.5">
      <SectionLabel>Add a friend</SectionLabel>
      <div className="flex gap-1.5">
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Their friend code"
          aria-label="Friend code"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={16}
          className="font-mono uppercase tracking-widest"
        />
        <Button type="submit" size="sm" disabled={redeem.isPending || code.trim().length < 6}>
          <UserPlus className="size-3.5" /> Add
        </Button>
      </div>
      {note && <p className="text-xs text-primary">{note}</p>}
      <ErrorLine error={redeem.error} />
    </form>
  );
}
