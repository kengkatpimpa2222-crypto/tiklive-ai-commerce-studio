import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { AiConfig } from "@tlai/ai";
import type { FaqEntry, HostCharacter, LiveScript, LiveSession, Product, Promotion, Scene, StudioSettings, ViewerQuestion } from "@tlai/shared";
import { defaultSettings, seedCharacters, seedFaqs, seedProducts, seedPromotions, seedScenes, seedScripts } from "./seed.js";

export interface Db {
  products: Product[];
  promotions: Promotion[];
  scenes: Scene[];
  characters: HostCharacter[];
  scripts: LiveScript[];
  sessions: LiveSession[];
  questions: ViewerQuestion[];
  faqs: FaqEntry[];
  settings: StudioSettings;
  /** AI provider for the host's speech. Holds the API key, so it is never sent to the stage. */
  ai?: AiConfig;
}

export type Collection = Exclude<keyof Db, "settings" | "ai">;
type Lists = Pick<Db, Collection>;

const seed = (): Db => ({
  products: structuredClone(seedProducts),
  promotions: structuredClone(seedPromotions),
  scenes: structuredClone(seedScenes),
  characters: structuredClone(seedCharacters),
  scripts: structuredClone(seedScripts),
  sessions: [],
  questions: [],
  faqs: structuredClone(seedFaqs),
  settings: structuredClone(defaultSettings),
});

/** Local JSON store. A desktop app for one seller does not need a database server. */
export class Store {
  readonly db: Db;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string | null) {
    if (file && existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<Db>;
      const base = seed();
      // Older data files gain new collections and settings fields with defaults.
      this.db = { ...base, ...saved, settings: { stage: { ...base.settings.stage, ...saved.settings?.stage } } };
    } else {
      this.db = seed();
      this.flush();
    }
  }

  list<K extends Collection>(k: K): Lists[K] {
    return this.db[k];
  }

  get<K extends Collection>(k: K, id: string): Lists[K][number] | undefined {
    return (this.db[k] as { id: string }[]).find((x) => x.id === id) as Lists[K][number] | undefined;
  }

  insert<K extends Collection>(k: K, item: Lists[K][number]): Lists[K][number] {
    (this.db[k] as Lists[K][number][]).push(item);
    this.save();
    return item;
  }

  update<K extends Collection>(k: K, id: string, patch: Partial<Lists[K][number]>): Lists[K][number] | undefined {
    const item = this.get(k, id);
    if (!item) return undefined;
    Object.assign(item as object, patch);
    this.save();
    return item;
  }

  remove(k: Collection, id: string): boolean {
    const arr = this.db[k] as { id: string }[];
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) return false;
    arr.splice(i, 1);
    this.save();
    return true;
  }

  setAi(cfg: AiConfig): void {
    this.db.ai = cfg;
    this.save();
  }

  updateStage(patch: Partial<StudioSettings["stage"]>): StudioSettings {
    Object.assign(this.db.settings.stage, patch);
    this.save();
    return this.db.settings;
  }

  /** Debounced write so a busy live session does not hammer the disk. */
  save(): void {
    if (!this.file) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush(): void {
    if (!this.file) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    renameSync(tmp, this.file);
  }
}
