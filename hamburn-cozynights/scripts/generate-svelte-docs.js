import sveltedoc from 'sveltedoc-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const componentsDir = path.join(__dirname, '../src/lib/components');
const outputDir = path.join(__dirname, '../docs/generated/svelte');

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

async function parseDirectory(dir) {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
            await parseDirectory(fullPath);
        } else if (file.endsWith('.svelte')) {
            console.log(`[SvelteDoc] Parsing ${file}...`);
            try {
                const doc = await sveltedoc.parse({
                    filename: fullPath,
                    version: 3 // sveltedoc-parser works best with v3/v4 syntax
                });
                
                const componentName = file.replace('.svelte', '');
                const outputPath = path.join(outputDir, `${componentName}.json`);
                fs.writeFileSync(outputPath, JSON.stringify(doc, null, 2));
            } catch (err) {
                console.warn(`[SvelteDoc] Could not parse ${file}: ${err.message}`);
            }
        }
    }
}

console.log('🚀 Starting Svelte Component Documentation extraction...');
parseDirectory(componentsDir).then(() => {
    console.log(`✅ Svelte docs generated in ${outputDir}`);
});
