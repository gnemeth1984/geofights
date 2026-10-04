import * as React from "react";
import { Link } from "wouter";
import { Check, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { errorMessage } from "@/lib/format";
import { useRequestPasswordReset, useResetPassword } from "@/queries/password";

/**
 * Both halves of "forgot password". Without a token it asks for the email;
 * with one (Better Auth redirects here as `?token=…`) it sets the new password.
 */
export default function ResetPassword() {
  const params = React.useMemo(() => new URLSearchParams(window.location.search), []);
  const token = params.get("token") ?? "";
  const badLink = params.get("error") === "INVALID_TOKEN";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Panel>
        <PanelHeader>
          <PanelTitle>
            <span className="inline-flex items-center gap-2">
              <KeyRound className="size-4 text-primary" /> GeoFights · reset password
            </span>
          </PanelTitle>
        </PanelHeader>
        <PanelBody className="space-y-4 text-sm leading-relaxed">
          {badLink && (
            <p className="text-destructive">That link has expired or was already used. Ask for a new one below.</p>
          )}
          {token && !badLink ? <NewPassword token={token} /> : <RequestLink />}
          <p className="text-[11px] text-muted-foreground">
            <Link href="/play" className="underline">
              Back to the game
            </Link>
          </p>
        </PanelBody>
      </Panel>
    </main>
  );
}

function RequestLink() {
  const [email, setEmail] = React.useState("");
  const request = useRequestPasswordReset();

  if (request.isSuccess) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 font-medium">
          <Check className="size-4 text-primary" /> Request received
        </p>
        <p className="text-muted-foreground">
          If {email} has a GeoFights account, a reset link goes to that address. It works for 24 hours. Nothing
          arrived? Check spam — and note that during launch some links are sent by hand by the team, which can take
          up to a day.
        </p>
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        request.mutate(email.trim());
      }}
    >
      <p className="text-muted-foreground">Enter the email you signed up with and we'll send a link to set a new password.</p>
      <Input
        type="email"
        required
        placeholder="you@example.com"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      {request.error && <p className="text-xs text-destructive">{errorMessage(request.error)}</p>}
      <Button type="submit" disabled={request.isPending || !email.includes("@")}>
        {request.isPending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}

function NewPassword({ token }: { token: string }) {
  const [password, setPassword] = React.useState("");
  const [again, setAgain] = React.useState("");
  const reset = useResetPassword();
  const mismatch = again.length > 0 && again !== password;

  if (reset.isSuccess) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 font-medium">
          <Check className="size-4 text-primary" /> Password changed
        </p>
        <p className="text-muted-foreground">You've been signed out everywhere. Sign in again with the new password.</p>
        <Button asChild>
          <Link href="/play">Sign in</Link>
        </Button>
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!mismatch) reset.mutate({ token, newPassword: password });
      }}
    >
      <p className="text-muted-foreground">Choose a new password — at least 8 characters.</p>
      <Input
        type="password"
        required
        minLength={8}
        placeholder="New password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Input
        type="password"
        required
        minLength={8}
        placeholder="Same again"
        autoComplete="new-password"
        value={again}
        onChange={(event) => setAgain(event.target.value)}
      />
      {mismatch && <p className="text-xs text-destructive">Those two don't match.</p>}
      {reset.error && <p className="text-xs text-destructive">{errorMessage(reset.error)}</p>}
      <Button type="submit" disabled={reset.isPending || password.length < 8 || mismatch}>
        {reset.isPending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
