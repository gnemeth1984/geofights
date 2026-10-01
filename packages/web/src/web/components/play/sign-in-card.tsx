import * as React from "react";
import { LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/format";
import { useSignIn, useSignUp } from "@/queries/session";
import { useCompleteSignup } from "@/queries/community";
import { useGeo } from "@/hooks/use-geo";
import { AgeLocationFields, useAgeLocation } from "@/components/play/age-location-step";

/**
 * Account step. Signing in is email + password. Creating an account also
 * needs an age band and a live location fix *before* the account exists —
 * the Create button stays disabled until both are in, so there is no such
 * thing as a GeoFights account without them. (An account that somehow ends
 * up without them is caught by the finish-sign-up gate on the play screen.)
 */
export function SignInCard({ initialMode = "in" }: { initialMode?: "in" | "up" } = {}) {
  const [mode, setMode] = React.useState<"in" | "up">(initialMode);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const signIn = useSignIn();
  const signUp = useSignUp();
  const completeSignup = useCompleteSignup();
  const geo = useGeo();
  const profile = useAgeLocation();

  const pending = signIn.isPending || signUp.isPending || completeSignup.isPending;
  const error = signIn.error ?? signUp.error ?? completeSignup.error;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === "in") {
      signIn.mutate({ email, password });
      return;
    }
    const payload = profile.payload();
    if (!profile.ready || !payload) return;
    try {
      await signUp.mutateAsync({ email, password, name: name || email.split("@")[0]! });
      await completeSignup.mutateAsync(payload);
      // The same answer also unlocks GPS on this device, so the play screen
      // does not ask the age question a second time.
      geo.grant({ ageBand: payload.ageBand, guardianConfirmed: payload.guardianConfirmed });
    } catch {
      /* surfaced through the mutation errors */
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {mode === "in" ? "Sign in to fight" : "Create a player"}
      </div>
      {mode === "up" && (
        <Input
          placeholder="Player name (no real names)"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="nickname"
          maxLength={24}
        />
      )}
      <Input
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        required
      />
      <Input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete={mode === "in" ? "current-password" : "new-password"}
        required
      />
      {mode === "up" && <AgeLocationFields form={profile} />}
      {error && <div className="text-xs text-destructive">{errorMessage(error)}</div>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || (mode === "up" && !profile.ready)}>
          {mode === "in" ? <LogIn className="size-4" /> : <UserPlus className="size-4" />}
          {pending ? "Working…" : mode === "in" ? "Sign in" : "Create account"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
        >
          {mode === "in" ? "No account yet?" : "I already have one"}
        </Button>
      </div>
    </form>
  );
}
