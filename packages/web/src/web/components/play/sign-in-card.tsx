import * as React from "react";
import { LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/format";
import { useSignIn, useSignUp } from "@/queries/session";

/**
 * Account step. The AR scene runs before this — a player can look at their
 * character and walk to a booster marker unauthenticated — but boosters, avatars
 * and matches are owned by an account, so combat needs one.
 */
export function SignInCard() {
  const [mode, setMode] = React.useState<"in" | "up">("in");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const signIn = useSignIn();
  const signUp = useSignUp();

  const pending = signIn.isPending || signUp.isPending;
  const error = signIn.error ?? signUp.error;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === "in") signIn.mutate({ email, password });
    else signUp.mutate({ email, password, name: name || email.split("@")[0]! });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {mode === "in" ? "Sign in to fight" : "Create a player"}
      </div>
      {mode === "up" && (
        <Input
          placeholder="Player name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="nickname"
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
      {error && <div className="text-xs text-destructive">{errorMessage(error)}</div>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
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
