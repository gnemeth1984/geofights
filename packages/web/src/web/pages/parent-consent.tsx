import * as React from "react";
import { Link } from "wouter";
import { Check, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { useRevokeParentConsent, useVerifyParentConsent } from "@/queries/community";
import { errorText } from "@/components/community/shared";

/**
 * Where the parent-consent email lands. Opening the link does nothing on its
 * own — mail scanners prefetch links, so a parent has to press the button.
 * The token in the URL is the only credential; no account is needed.
 */
export default function ParentConsent() {
  const token = React.useMemo(() => new URLSearchParams(window.location.search).get("token") ?? "", []);
  const verify = useVerifyParentConsent();
  const revoke = useRevokeParentConsent();
  const error = errorText(verify.error ?? revoke.error);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-10">
      <Panel>
        <PanelHeader>
          <PanelTitle>
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" /> GeoFights · parent permission
            </span>
          </PanelTitle>
        </PanelHeader>
        <PanelBody className="space-y-4 text-sm leading-relaxed">
          {!token ? (
            <p>This link is missing its code. Open the link from the email again.</p>
          ) : revoke.isSuccess ? (
            <p>
              Permission withdrawn. Friends, chat, teams and fights with other players are switched off for this
              account straight away. Solo training still works.
            </p>
          ) : verify.isSuccess ? (
            <>
              <p className="flex items-center gap-2 font-medium">
                <Check className="size-4 text-primary" />
                {verify.data.alreadyDone
                  ? "You have already given permission."
                  : `Thank you — ${"username" in verify.data ? verify.data.username : "your child"} can now play with other players.`}
              </p>
              <p className="text-muted-foreground">
                Keep this email. If you change your mind, open the same link and withdraw permission at any time.
              </p>
              <Button variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate({ token })}>
                <X className="size-4" /> Withdraw permission
              </Button>
            </>
          ) : (
            <>
              <p>Your child has asked to play GeoFights, a free augmented-reality battle game played in parks.</p>
              <div className="space-y-1.5 rounded-md border border-border bg-background/50 p-3 text-xs">
                <p className="font-medium">If you say yes, they can:</p>
                <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                  <li>Add friends by swapping a code in person — nobody can search for them.</li>
                  <li>Chat using ready-made phrases only (no typing under 13).</li>
                  <li>Join a team and battle other players aged under 18.</li>
                  <li>See meet-ups at approved parks, between 8am and 8pm, for under-18s only.</li>
                </ul>
                <p className="pt-1 text-muted-foreground">
                  Adults are never matched with, friended by, or able to chat with players under 18. Only a rough
                  home area is stored, never an exact address.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={verify.isPending} onClick={() => verify.mutate({ token })}>
                  <Check className="size-4" /> I am the parent — I give permission
                </Button>
                <Button variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate({ token })}>
                  No, do not allow
                </Button>
              </div>
            </>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <p className="text-[11px] text-muted-foreground">
            <Link href="/" className="underline">
              About GeoFights
            </Link>
          </p>
        </PanelBody>
      </Panel>
    </main>
  );
}
