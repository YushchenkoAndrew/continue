import type { IDE } from "../..";

export interface InstalledVersion {
  version: string;
  source: string;
  exact: boolean;
}

async function read(
  ide: IDE,
  root: string,
  rel: string,
): Promise<string | undefined> {
  const uri = `${root.replace(/\/$/, "")}/${rel}`;
  try {
    return (await ide.fileExists(uri)) ? await ide.readFile(uri) : undefined;
  } catch {
    return undefined;
  }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Installed version of a library from lockfiles (exact) or manifests (range).
 * Looks in the workspace root and the directories of known manifests.
 */
export async function findInstalledVersion(
  ide: IDE,
  name: string,
  dirs: string[] = [""],
): Promise<InstalledVersion | undefined> {
  const root = (await ide.getWorkspaceDirs())[0];
  if (!root) return undefined;
  const n = esc(name);

  for (const dir of dirs) {
    const p = (f: string) => (dir ? `${dir}/${f}` : f);

    const lock = await read(ide, root, p("package-lock.json"));
    if (lock) {
      try {
        const j = JSON.parse(lock);
        const v =
          j.packages?.[`node_modules/${name}`]?.version ??
          j.dependencies?.[name]?.version;
        if (v)
          return { version: v, source: p("package-lock.json"), exact: true };
      } catch {
        /* ignore */
      }
    }
    const pnpm = await read(ide, root, p("pnpm-lock.yaml"));
    const pm =
      pnpm?.match(new RegExp(`^\\s+'?/?${n}[@/]'?(\\d[\\w.\\-+]*)`, "m")) ??
      pnpm?.match(
        new RegExp(
          `^\\s+${n}:\\s*\\n\\s+specifier:.*\\n\\s+version:\\s*(\\d[\\w.\\-+]*)`,
          "m",
        ),
      );
    if (pm) return { version: pm[1], source: p("pnpm-lock.yaml"), exact: true };
    const yarn = await read(ide, root, p("yarn.lock"));
    const ym = yarn?.match(
      new RegExp(`^"?${n}@[^\\n]*\\n\\s+version:? "?([\\d][\\w.\\-+]*)"?`, "m"),
    );
    if (ym) return { version: ym[1], source: p("yarn.lock"), exact: true };

    const pkg = await read(ide, root, p("package.json"));
    if (pkg) {
      try {
        const j = JSON.parse(pkg);
        const spec =
          j.dependencies?.[name] ??
          j.devDependencies?.[name] ??
          j.peerDependencies?.[name];
        if (spec)
          return {
            version: String(spec),
            source: p("package.json"),
            exact: false,
          };
      } catch {
        /* ignore */
      }
    }

    const req = await read(ide, root, p("requirements.txt"));
    const rm = req?.match(
      new RegExp(`^${n}\\s*(==|>=|~=|<=)\\s*([\\w.\\-+]+)`, "im"),
    );
    if (rm)
      return {
        version: `${rm[1]}${rm[2]}`,
        source: p("requirements.txt"),
        exact: rm[1] === "==",
      };
    const poetry = await read(ide, root, p("poetry.lock"));
    const pl = poetry?.match(
      new RegExp(`name = "${n}"\\nversion = "([^"]+)"`, "i"),
    );
    if (pl) return { version: pl[1], source: p("poetry.lock"), exact: true };
    const py = await read(ide, root, p("pyproject.toml"));
    const pym = py?.match(
      new RegExp(
        `["']?${n}["']?\\s*(?:=\\s*["']|(==|>=|~=|\\^))\\s*([\\w.\\-+^~>=<]+)`,
        "i",
      ),
    );
    if (pym)
      return {
        version: (pym[1] ?? "") + pym[2],
        source: p("pyproject.toml"),
        exact: false,
      };

    const gomod = await read(ide, root, p("go.mod"));
    const gm = gomod?.match(new RegExp(`${n}\\s+(v[\\w.\\-+]+)`));
    if (gm) return { version: gm[1], source: p("go.mod"), exact: true };

    const cargoLock = await read(ide, root, p("Cargo.lock"));
    const cl = cargoLock?.match(
      new RegExp(`name = "${n}"\\nversion = "([^"]+)"`),
    );
    if (cl) return { version: cl[1], source: p("Cargo.lock"), exact: true };
    const cargo = await read(ide, root, p("Cargo.toml"));
    const cm = cargo?.match(
      new RegExp(
        `^${n}\\s*=\\s*(?:"([^"]+)"|\\{[^}]*version\\s*=\\s*"([^"]+)")`,
        "m",
      ),
    );
    if (cm)
      return { version: cm[1] ?? cm[2], source: p("Cargo.toml"), exact: false };
  }
  return undefined;
}
