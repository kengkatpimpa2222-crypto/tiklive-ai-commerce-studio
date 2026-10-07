import { useHash } from "./lib/useHash";
import { CatalogPage } from "./pages/CatalogPage";
import { CharactersPage } from "./pages/CharactersPage";
import { ControlPage } from "./pages/ControlPage";
import { ScriptsPage } from "./pages/ScriptsPage";
import { SummaryPage } from "./pages/SummaryPage";
import { StagePage } from "./stage/StagePage";

const NAV = [
  ["/", "ห้องควบคุม LIVE"],
  ["/catalog", "สินค้าและโปรโมชั่น"],
  ["/characters", "ตัวละคร AI"],
  ["/scripts", "สคริปต์"],
  ["/summary", "สรุปผล LIVE"],
] as const;

export function App() {
  const route = useHash();
  if (route.startsWith("/stage")) return <StagePage />;
  const page = route.startsWith("/catalog") ? (
    <CatalogPage />
  ) : route.startsWith("/characters") ? (
    <CharactersPage />
  ) : route.startsWith("/scripts") ? (
    <ScriptsPage />
  ) : route.startsWith("/summary") ? (
    <SummaryPage id={route.split("/")[2]} />
  ) : (
    <ControlPage />
  );
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">
          TikLive <b>AI</b> Commerce Studio
        </div>
        {NAV.map(([href, label]) => (
          <a key={href} href={`#${href}`} className={(href === "/" ? route === "/" : route.startsWith(href)) ? "active" : ""}>
            {label}
          </a>
        ))}
        <a href="#/stage" target="_blank" rel="noreferrer" className="stage-link">
          เปิดหน้าจอ Stage ↗
        </a>
      </nav>
      <main className="main">{page}</main>
    </div>
  );
}
