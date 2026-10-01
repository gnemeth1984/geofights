import * as React from "react";
import { Link } from "wouter";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { useSession } from "@/queries/session";
import { useCommunityAccess, useRedeemInvite } from "@/queries/community";
import { PENDING_INVITE_KEY, errorText } from "@/components/community/shared";

/**
 * Where a scanned friend QR lands. Nothing happens without a tap — the player
 * sees whose request they are about to send only after the server accepts the
 * code, and a signed-out visitor has the code kept for after sign-in.
 */
export default function AddFriend() {
  const code = React.useMemo(
    () => (new URLSearchParams(window.location.search).get("code") ?? "").trim().toUpperCase(),
    [],
  );
  const session = useSession();
  const signedIn = Boolean(session.data?.user);
  const access = useCommunityAccess(signedIn);
  const redeem = useRedeemInvite();

  React.useEffect(() => {
    if (!code) return;
    try {
      window.localStorage.setItem(PENDING_INVITE_KEY, code);
    } catch {
      /* private mode — the code is still on screen */
    }
  }, [code]);

  const clearPending = () => {
    try {
      window.localStorage.removeItem(PENDING_INVITE_KEY);
    } catch {
      /* ignore */
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Panel>
        <PanelHeader>
          <PanelTitle>
            <span className="inline-flex items-center gap-2">
              <UserPlus className="size-4 text-primary" /> Add a friend
            </span>
          </PanelTitle>
        </PanelHeader>
        <PanelBody className="space-y-4 text-sm">
          {!code ? (
            <p>This link has no friend code in it.</p>
          ) : (
            <div className="rounded-md border border-border bg-background/50 p-3 text-center font-mono text-xl tracking-[0.25em]">
              {code}
            </div>
          )}

          {code && !signedIn && !session.isPending && (
            <>
              <p className="text-muted-foreground">Sign in or create an account, and the code will be waiting.</p>
              <Button asChild className="w-full">
                <Link href="/play">Sign in to GeoFights</Link>
              </Button>
            </>
          )}

          {code && signedIn && access.data && !access.data.community && (
            <p className="text-muted-foreground">{access.data.blockedBy ?? "Friends are not available on this account yet."}</p>
          )}

          {code && signedIn && access.data?.community && !redeem.isSuccess && (
            <Button
              className="w-full"
              disabled={redeem.isPending}
              onClick={() => redeem.mutate({ code }, { onSuccess: clearPending })}
            >
              <UserPlus className="size-4" /> Send friend request
            </Button>
          )}

          {redeem.isSuccess && (
            <p className="font-medium">
              {redeem.data.status === "accepted"
                ? `You and ${redeem.data.username} are now friends.`
                : `Request sent to ${redeem.data.username}. They need to accept it.`}
            </p>
          )}
          {redeem.error && <p className="text-xs text-destructive">{errorText(redeem.error)}</p>}

          {signedIn && (
            <Button asChild variant="outline" className="w-full">
              <Link href="/play">Back to the game</Link>
            </Button>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Only add people you know in real life. Adults and under-18s cannot be friends on GeoFights.
          </p>
        </PanelBody>
      </Panel>
    </main>
  );
}
