import { useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { ErrorNote } from "@/components/admin/state";
import { useSignIn, useSignUp } from "@/queries/session";

/**
 * Operator sign-in. Email/password only — this is an internal console, not a
 * player-facing screen. An account is granted the `admin` role when it is the
 * first account on a fresh install or when its email is in `ADMIN_EMAILS`.
 */
export function LoginCard() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const signIn = useSignIn();
  const signUp = useSignUp();
  const pending = signIn.isPending || signUp.isPending;
  const error = signIn.error ?? signUp.error;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "signin") signIn.mutate({ email, password });
    else signUp.mutate({ email, password, name: name || email.split("@")[0]! });
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <Panel>
        <PanelHeader>
          <PanelTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            Operator access
          </PanelTitle>
          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="text-xs text-primary underline-offset-4 hover:underline"
          >
            {mode === "signin" ? "Create account" : "Have an account?"}
          </button>
        </PanelHeader>
        <PanelBody>
          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" ? (
              <div className="space-y-1.5">
                <Label htmlFor="name">Display name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ops"
                  autoComplete="name"
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@arbattle.test"
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
            </div>
            <ErrorNote error={error} />
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              {mode === "signin" ? "Sign in" : "Create operator account"}
            </Button>
          </form>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Sessions are Better Auth cookies on <span className="font-mono">/api/auth</span>. The
            console only renders for accounts whose player role is{" "}
            <span className="font-mono">admin</span> — everything else gets{" "}
            <span className="font-mono">FORBIDDEN</span> from the server, not a hidden button.
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}
