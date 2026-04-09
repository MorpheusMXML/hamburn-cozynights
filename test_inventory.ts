import PocketBase from 'pocketbase';
import { InventoryService } from './hamburn-cozynights/src/lib/server/inventory';

const pb = new PocketBase('http://127.0.0.1:8090');

async function test() {
    const inventory = new InventoryService(pb as any);
    const tree = await inventory.getFullTree();
    console.log(JSON.stringify(tree, null, 2));
}

test().catch(console.error);
