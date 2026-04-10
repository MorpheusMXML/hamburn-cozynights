import type { TypedPocketBase, OrdersResponse, BedsResponse } from '$lib/pocketbase-types';
import { createLookupHash, encrypt } from '$lib/server/crypto';

export class BookingService {
    constructor(private adminPb: TypedPocketBase) {}

    /**
     * Resolves an order by its number, performing auto-migration to order_hash if needed.
     */
    async getOrderByNumber(orderNumber: string): Promise<OrdersResponse | null> {
        if (!orderNumber) return null;
        const orderHash = createLookupHash(orderNumber);

        try {
            // 1. Try secure lookup by hash
            return await this.adminPb.collection('orders').getFirstListItem<OrdersResponse>(
                this.adminPb.filter('order_hash = {:orderHash}', { orderHash })
            );
        } catch {
            try {
                // 2. Fallback to legacy number lookup
                const order = await this.adminPb.collection('orders').getFirstListItem<OrdersResponse>(
                    this.adminPb.filter('order_number = {:orderNumber}', { orderNumber })
                );
                
                // 3. Auto-migrate to hash silently
                await this.adminPb.collection('orders').update(order.id, { order_hash: orderHash }).catch(() => {});
                return order;
            } catch {
                return null;
            }
        }
    }

    /**
     * Finds the bed currently booked for a specific order.
     */
    async getBedForOrder(orderId: string): Promise<BedsResponse | null> {
        return await this.adminPb.collection('beds').getFirstListItem(
            this.adminPb.filter('order = {:orderId}', { orderId })
        ).catch(() => null);
    }

    /**
     * Performs a bed booking for a user.
     */
    async bookBed(order: OrdersResponse, bedId: string, guestName: string): Promise<void> {
        // Release previous bookings
        const previousBeds = await this.adminPb.collection('beds').getFullList({
            filter: this.adminPb.filter('order = {:orderId}', { orderId: order.id })
        });
        
        for (const prevBed of previousBeds) {
            if (prevBed.id !== bedId) {
                await this.adminPb.collection('beds').update(prevBed.id, { occupied: false, order: null });
            }
        }

        // Update Order Burner Name
        await this.adminPb.collection('orders').update(order.id, { 
            burner_name: encrypt(guestName) 
        });

        // Claim new spot
        await this.adminPb.collection('beds').update(bedId, {
            occupied: true,
            order: order.id
        });
    }

    /**
     * Releases all spots for an order.
     */
    async unbookOrder(orderId: string): Promise<void> {
        const beds = await this.adminPb.collection('beds').getFullList({ 
            filter: this.adminPb.filter('order = {:orderId}', { orderId }) 
        });
        
        for (const bed of beds) {
            await this.adminPb.collection('beds').update(bed.id, { occupied: false, order: null });
        }
    }
}
