/**
 * Serves the vendored pstack skills through `ctx.skills`.
 *
 * A skill keeps upstream's invocation policy: one marked
 * `disable-model-invocation` appears in the user's `/` list and stays out of
 * the model's catalog. poteto-mode reaches those by path, and every skill's
 * resource base is its real folder, so `../<name>/SKILL.md` resolves.
 *
 * @module @qybaihe/dsh-pstack/skills
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill';
import { parseSkillFile } from '../core/skill-file.js';
export const name = 'pstack-skills';
export const inject = ['skills'];
export const PROVIDER_NAME = 'pstack';
/** `vendor/pstack/skills`, from `lib/skills/index.js` or `src/skills/index.ts`. */
function bundledSkillsRoot() {
    try {
        return fileURLToPath(new URL('../../vendor/pstack/skills', import.meta.url));
    }
    catch {
        // A host that loads modules from a non-file URL has no folder to serve.
        return undefined;
    }
}
function throwIfAborted(control, options) {
    control.signal.throwIfAborted();
    options.signal?.throwIfAborted();
}
async function readCandidate(root, folder) {
    const path = join(root, folder, 'SKILL.md');
    const skill = parseSkillFile(await readFile(path, 'utf8'));
    if (skill === undefined)
        return undefined;
    return {
        name: skill.name,
        description: skill.description,
        invocation: { modelInvocable: skill.modelInvocable, userInvocable: true },
        source: 'bundled',
        provider: PROVIDER_NAME,
        resourceBase: { kind: 'directory', path: join(root, folder) },
        path,
        rank: BUNDLED_SKILL_RANK,
        locator: path,
    };
}
export function createProvider(control, root = bundledSkillsRoot()) {
    // The vendored tree cannot change while a registration lives, so one
    // complete walk serves every later lookup. A partial walk is never kept.
    let complete;
    async function list(options) {
        throwIfAborted(control, options);
        if (complete !== undefined)
            return { candidates: complete, complete: true };
        if (root === undefined)
            return { candidates: [], complete: false };
        let folders;
        try {
            const entries = await readdir(root, { withFileTypes: true });
            folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
        }
        catch {
            return { candidates: [], complete: false };
        }
        const candidates = [];
        let missed = false;
        for (const folder of folders) {
            throwIfAborted(control, options);
            const candidate = await readCandidate(root, folder).catch(() => undefined);
            if (candidate === undefined)
                missed = true;
            else
                candidates.push(candidate);
        }
        if (!missed)
            complete = candidates;
        return { candidates, complete: !missed };
    }
    async function get(candidate, options) {
        throwIfAborted(control, options);
        if (typeof candidate.locator !== 'string')
            return undefined;
        const skill = parseSkillFile(await readFile(candidate.locator, 'utf8'));
        if (skill === undefined)
            return undefined;
        const { rank: _rank, locator: _locator, ...summary } = candidate;
        return { ...summary, content: skill.body };
    }
    return { name: PROVIDER_NAME, list, get };
}
export function apply(ctx) {
    ctx.effect(() => ctx.skills.registerProvider((control) => createProvider(control)));
}
