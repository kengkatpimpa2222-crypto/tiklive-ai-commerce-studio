import { useHash } from "./lib/useHash";
import { AiPage } from "./pages/AiPage";
import { CatalogPage } from "./pages/CatalogPage";
import { CharactersPage } from "./pages/CharactersPage";
import { ControlPage } from "./pages/ControlPage";
import { QuickAskPage } from "./pages/QuickAskPage";
import { ScriptsPage } from "./pages/ScriptsPage";
import { ShopPage } from "./pages/ShopPage";
import { SummaryPage } from "./pages/SummaryPage";
import { StagePage } from "./stage/StagePage";

const NAV = [
  ["/", "ห้องควบคุม LIVE"],
  ["/catalog", "สินค้าและโปรโมชั่น"],
  ["/shop", "ร้านและหน้าจอ"],
  ["/characters", "ตัวละคร AI"],
  ["/ai", "สมอง AI"],
  ["/scripts", "สคริปต์"],
  ["/summary", "สรุปผล LIVE"],
] as const;

document.title = `TikLive AI Commerce Studio v${__APP_VERSION__}`;

export function App() {
  const route = useHash();
  if (route.startsWith("/stage")) return <StagePage />;
  if (route.startsWith("/quick")) return <QuickAskPage />;
  const page = route.startsWith("/catalog") ? (
    <CatalogPage />
  ) : route.startsWith("/shop") ? (
    <ShopPage />
  ) : route.startsWith("/ai") ? (
    <AiPage />
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
          TikLive <b>AI</b> Commerce Studio <span className="ver" title="เวอร์ชันที่ติดตั้งอยู่">v{__APP_VERSION__}</span>
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
