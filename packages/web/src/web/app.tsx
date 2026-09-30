import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import Index from "./pages/index";
import Admin from "./pages/admin";
import Docs from "./pages/docs";

// The AR client pulls in Three.js — a third of the bundle on its own. Split so
// the console and the landing page do not pay for a renderer they never use.
const Play = lazy(() => import("./pages/play"));
// Same reason, and the lab is a dev/review tool: nothing links to it.
const CharacterLab = lazy(() => import("./pages/character-lab"));
import { Provider } from "./components/provider";
import { InstallPrompt } from "./components/install-prompt";
import { AgentFeedback, RunableBadge } from "@runablehq/website-runtime";

function App() {
  return (
    <Provider>
      <Switch>
        <Route path="/" component={Index} />
        <Route path="/admin" component={Admin} />
        <Route path="/docs" component={Docs} />
        <Route path="/play">
          <Suspense
            fallback={
              <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">
                Loading the arena…
              </div>
            }
          >
            <Play />
          </Suspense>
        </Route>
        <Route path="/character-lab">
          <Suspense
            fallback={
              <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">
                Loading the lab…
              </div>
            }
          >
            <CharacterLab />
          </Suspense>
        </Route>
      </Switch>
      {/* "Add to home screen" bar — hides itself once installed or dismissed. */}
      <InstallPrompt />
      {/* Do not remove — off by default, activated by parent iframe via postMessage */}
      {import.meta.env.DEV && <AgentFeedback />}
      {/* "Made with Runable" badge - if user asks to remove the runable badge, remove this code as well as comment */}
      {<RunableBadge />}
    </Provider>
  );
}

export default App;
