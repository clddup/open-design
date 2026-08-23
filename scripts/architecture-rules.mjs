import ts from "typescript";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

export function sourceImports(source, fileName = "source.ts") {
  const syntax = fileName.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    syntax,
  );
  const imports = [];
  const add = (specifier, typeOnly) => {
    if (specifier !== undefined) imports.push({ specifier, typeOnly });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      add(
        stringLiteral(node.moduleSpecifier),
        importDeclarationIsTypeOnly(node),
      );
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(
        stringLiteral(node.moduleSpecifier),
        exportDeclarationIsTypeOnly(node),
      );
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(stringLiteral(node.moduleReference.expression), node.isTypeOnly);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      add(stringLiteral(node.arguments[0]), false);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return imports;
}

export function packageRoot(specifier) {
  if (specifier.startsWith("node:")) return specifier;
  if (specifier.startsWith("virtual:")) return specifier;
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

export function processImportViolation(dependency, policy) {
  if (dependency.specifier.startsWith(".") || dependency.typeOnly) return null;
  const packageName = packageRoot(dependency.specifier);
  if (packageName === "electron" || packageName.startsWith("node:")) {
    return matchesAllowed(packageName, policy.allowedBuiltins ?? [])
      ? null
      : `imports unapproved ${packageName}`;
  }
  return (policy.allowedPackages ?? []).includes(packageName)
    ? null
    : `imports package ${packageName} outside the process allowlist`;
}

export function resolveSourceImport(
  importer,
  specifier,
  sourcePaths,
  aliases = {},
) {
  const cleanSpecifier = stripQuery(specifier);
  const target = cleanSpecifier.startsWith(".")
    ? resolve(dirname(importer), cleanSpecifier)
    : resolveAliasedImport(cleanSpecifier, aliases);
  if (!target) return null;
  const candidates = [target];
  const extension = extname(target);
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    const withoutExtension = target.slice(0, -extension.length);
    candidates.push(`${withoutExtension}.ts`, `${withoutExtension}.tsx`);
  } else if (!extension) {
    candidates.push(
      `${target}.ts`,
      `${target}.tsx`,
      resolve(target, "index.ts"),
      resolve(target, "index.tsx"),
    );
  }
  return candidates.find((candidate) => sourcePaths.has(candidate)) ?? null;
}

export function resolveAliasedImport(specifier, aliases) {
  for (const [alias, root] of Object.entries(aliases)) {
    if (specifier === alias) return resolve(root);
    if (specifier.startsWith(`${alias}/`)) {
      const target = resolve(root, specifier.slice(alias.length + 1));
      return pathIsWithin(root, target) ? target : null;
    }
  }
  return null;
}

export function isAliasedImport(specifier, aliases) {
  return Object.keys(aliases).some(
    (alias) => specifier === alias || specifier.startsWith(`${alias}/`),
  );
}

export function pathIsWithin(root, target) {
  const path = relative(resolve(root), resolve(target));
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

export function featureOwnershipViolation({
  compositionFeature,
  governedFeatures,
  sourceFeature,
  specifier,
  targetFeature,
  targetPath,
}) {
  const governed = new Set(governedFeatures);
  if (governed.has(sourceFeature) && targetFeature === compositionFeature) {
    return `${sourceFeature} cannot depend on its ${compositionFeature} composition layer`;
  }
  if (
    sourceFeature !== targetFeature &&
    governed.has(targetFeature) &&
    targetPath !== "index.ts" &&
    targetPath !== "index.tsx"
  ) {
    return `${sourceFeature} must consume ${targetFeature} through its public entry`;
  }
  if (
    sourceFeature !== targetFeature &&
    governed.has(targetFeature) &&
    specifier?.startsWith(".")
  ) {
    return `${sourceFeature ?? "renderer"} must consume ${targetFeature} through the configured source alias`;
  }
  return null;
}

export function assertAcyclicGraph(graph, label = "source dependency") {
  const visited = new Set();
  const active = new Set();
  const visit = (name, path) => {
    if (active.has(name)) {
      throw new Error(`${label} cycle: ${[...path, name].join(" → ")}`);
    }
    if (visited.has(name)) return;
    active.add(name);
    for (const dependency of graph.get(name) ?? []) {
      visit(dependency, [...path, name]);
    }
    active.delete(name);
    visited.add(name);
  };
  for (const name of graph.keys()) visit(name, []);
}

export function packageExportAllowsSpecifier(manifest, specifier) {
  if (specifier === manifest.name) return true;
  if (!specifier.startsWith(`${manifest.name}/`)) return false;
  const subpath = `./${specifier.slice(manifest.name.length + 1)}`;
  const exports = manifest.exports;
  if (!exports || typeof exports !== "object" || Array.isArray(exports)) {
    return false;
  }
  return Object.keys(exports).some((candidate) =>
    exportKeyMatches(candidate, subpath),
  );
}

function importDeclarationIsTypeOnly(node) {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function exportDeclarationIsTypeOnly(node) {
  if (node.isTypeOnly) return true;
  return (
    node.exportClause !== undefined &&
    ts.isNamedExports(node.exportClause) &&
    node.exportClause.elements.length > 0 &&
    node.exportClause.elements.every((element) => element.isTypeOnly)
  );
}

function stringLiteral(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function stripQuery(specifier) {
  return specifier.split(/[?#]/u, 1)[0];
}

function exportKeyMatches(candidate, subpath) {
  if (candidate === subpath) return true;
  const wildcard = candidate.indexOf("*");
  if (wildcard < 0) return false;
  return (
    subpath.startsWith(candidate.slice(0, wildcard)) &&
    subpath.endsWith(candidate.slice(wildcard + 1))
  );
}

function matchesAllowed(value, allowed) {
  return allowed.some((candidate) =>
    candidate.endsWith(":") ? value.startsWith(candidate) : value === candidate,
  );
}
