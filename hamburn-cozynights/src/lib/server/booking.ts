import type { TypedPocketBase, OrdersResponse, BedsResponse } from '$lib/pocketbase-types';
import { createLookupHash, encrypt } from '$lib/server/crypto';

export class BookingService {
    constructor(private adminPb: TypedPocketBase) {}

    /**
     * Resolves an order by its number, performing auto-migration to order_hash if needed.
     */
    async getOrderByNumber(orderNumber: string): Promise<OrdersResponse | null> {
        if (!orderNumber) {
            console.warn('[BookingService] No orderNumber provided.');
            return null;
        }
        const orderHash = createLookupHash(orderNumber);
        console.log(`[BookingService] Looking up order for number: ${orderNumber} (Hash: ${orderHash.substring(0, 10)}...)`);

        try {
            // 1. Try secure lookup by hash
            const order = await this.adminPb.collection('orders').getFirstListItem<OrdersResponse>(
                this.adminPb.filter('order_hash = {:orderHash}', { orderHash })
            );
            console.log(`[BookingService] Order found via hash: ${order.id}`);
            return order;
        } catch (err: any) {
            console.log(`[BookingService] Hash lookup failed (${err.status}), trying fallback...`);
            try {
                // 2. Fallback to legacy number lookup
                const order = await this.adminPb.collection('orders').getFirstListItem<OrdersResponse>(
                    this.adminPb.filter('order_number = {:orderNumber}', { orderNumber })
                );
                
                console.log(`[BookingService] Order found via fallback number: ${order.id}. Migrating...`);
                // 3. Auto-migrate to hash silently
                await this.adminPb.collection('orders').update(order.id, { order_hash: orderHash }).catch(e => {
                    console.error(`[BookingService] Migration failed: ${e.message}`);
                });
                return order;
            } catch (numErr: any) {
                console.error(`[BookingService] Both lookups failed for ${orderNumber}: ${numErr.status}`);
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
        ).catch(() => {
            console.log(`[BookingService] No bed found for order: ${orderId}`);
            return null;
        });
    }

    /**
     * Performs a bed booking for a user.
     */
    async bookBed(order: OrdersResponse, bedId: string, guestName: string): Promise<void> {
        console.log(`[BookingService] Booking bed ${bedId} for order ${order.id} (Guest: ${guestName})`);
        
        // Release previous bookings
        const previousBeds = await this.adminPb.collection('beds').getFullList({
            filter: this.adminPb.filter('order = {:orderId}', { orderId: order.id })
        });
        
        console.log(`[BookingService] Found ${previousBeds.length} previous bookings to release.`);
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
        console.log(`[BookingService] Booking finalized successfully.`);
    }

    /**
     * Releases all spots for an order.
     */
    async unbookOrder(orderId: string): Promise<void> {
        console.log(`[BookingService] Unbooking all beds for order ${orderId}`);
        const beds = await this.adminPb.collection('beds').getFullList({ 
            filter: this.adminPb.filter('order = {:orderId}', { orderId }) 
        });
        
        for (const bed of beds) {
            await this.adminPb.collection('beds').update(bed.id, { occupied: false, order: null });
        }
        console.log(`[BookingService] Unbooked ${beds.length} beds.`);
    }
}
