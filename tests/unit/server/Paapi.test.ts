
// Require the dev-dependencies
import { Paapi } from '../../../src/server/Paapi';
const paapi = new Paapi();

describe('get a missing product', () => {
    it('should return null', async () => {
        const product = await paapi.getItemApi('B00X4WHP5E');
        expect(product).toBe(null);
    });
});
