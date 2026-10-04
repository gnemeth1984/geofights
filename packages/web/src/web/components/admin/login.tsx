import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { ErrorNote } from "@/components/admin/state";
import { useSignIn } from "@/queries/session";

/**
 * Operator sign-in for /admin. Sign-in only — there is deliberately no way to
 * create an account here. Operators are accounts whose email is in
 * `ADMIN_EMAILS` (promoted on their next sign-in) or that an existing operator
 * promoted from the Players tab. Every `admin.*` call is checked server-side.
 */
export function LoginCard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const signIn = useSignIn();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    signIn.mutate({ email: email.trim(), password });
  }

  return (
    <div className="mx-auto w-full max-w-sm pt-6 sm:pt-12">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-xl border border-primary/40 bg-primary/10">
          <ShieldCheck className="size-6 text-primary" />
        </div>
        <h1 className="font-display text-2xl font-semibold">GeoFights admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in with an operator account.
        </p>
      </div>
      <Panel>
        <PanelHeader>
          <PanelTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            Operator sign-in
          </PanelTitle>
        </PanelHeader>
        <PanelBody>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@geofights.com"
                autoComplete="username"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-password">Password</Label>
              <div className="relative">
                <Input
                  id="admin-password"
                  type={show ? "text" : "password"}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <ErrorNote error={signIn.error} />
            <Button type="submit" className="w-full" disabled={signIn.isPending}>
              {signIn.isPending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              Sign in
            </Button>
          </form>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Same email and password as your player account. Only operator accounts get past this
            screen — everyone else is refused by the server.{" "}
            <Link href="/reset-password" className="underline hover:text-foreground">
              Forgot password?
            </Link>
          </p>
        </PanelBody>
      </Panel>
      <div className="mt-4 text-center">
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" />
          Back to GeoFights
        </Link>
      </div>
    </div>
  );
}
