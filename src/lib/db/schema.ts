import {
  pgTable,
  serial,
  text,
  integer,
  date,
  boolean,
  uniqueIndex,
  pgEnum,
  check
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// --- Enums
export const bunkPositionEnum = pgEnum('bunk_position', ['low', 'up', 'single']);
export const bookingStatusEnum = pgEnum('booking_status', ['Booked', 'Pending', 'Cancelled']);

// --- ACCOMMODATION_AREA
export const accommodationArea = pgTable('accommodation_area', {
  areaId: serial('area_id').primaryKey(),
  name: text('name').notNull(),
  description: text('description')
});

// --- HOUSE
export const house = pgTable('house', {
  houseId: serial('house_id').primaryKey(),
  areaId: integer('area_id')
    .notNull()
    .references(() => accommodationArea.areaId, { onDelete: 'cascade' }),
  houseName: text('house_name').notNull(),
  notes: text('notes')
});

// --- ROOM
export const room = pgTable('room', {
  roomId: serial('room_id').primaryKey(),
  houseId: integer('house_id')
    .notNull()
    .references(() => house.houseId, { onDelete: 'cascade' }),
  roomName: text('room_name').notNull(),
  floor: text('floor') // e.g. '1st Floor', 'Downstairs'
});

// --- BED
export const bed = pgTable(
  'bed',
  {
    bedId: serial('bed_id').primaryKey(),
    roomId: integer('room_id')
      .notNull()
      .references(() => room.roomId, { onDelete: 'cascade' }),
    bedNumber: integer('bed_number').notNull(), // bunk unit number
    bunkPosition: bunkPositionEnum('bunk_position').notNull(), // 'low' | 'up' | 'single'
    sizeCm: text('size_cm') // '80 x 190 cm'
  },
  (table) => ({
    uxBedPerBunk: uniqueIndex('ux_bed_room_bunk').on(
      table.roomId,
      table.bedNumber,
      table.bunkPosition
    )
  })
);

// --- GUEST
export const guest = pgTable(
  'guest',
  {
    guestId: serial('guest_id').primaryKey(),
    orderNumber: text('order_number').notNull(),
    playaName: text('playa_name')
  },
  (table) => ({
    uxOrderNumber: uniqueIndex('ux_guest_order_number').on(table.orderNumber)
  })
);

// --- BOOKING
export const booking = pgTable(
  'booking',
  {
    bookingId: serial('booking_id').primaryKey(),
    bedId: integer('bed_id')
      .notNull()
      .references(() => bed.bedId, { onDelete: 'restrict' }),
    guestId: integer('guest_id')
      .notNull()
      .references(() => guest.guestId, { onDelete: 'cascade' }),
    checkInDate: date('check_in_date').notNull(),
    checkOutDate: date('check_out_date').notNull(),
    status: bookingStatusEnum('status').notNull().default('Pending'),
    isCancelled: boolean('is_cancelled').notNull().default(false)
  },
  (table) => ({
    // 1 bed per order (assuming single fixed event)
    uxBookingGuest: uniqueIndex('ux_booking_guest').on(table.guestId),
    // prevent double booking of the same bed for the exact same dates
    uxBookingBedDates: uniqueIndex('ux_booking_bed_dates').on(
      table.bedId,
      table.checkInDate,
      table.checkOutDate
    ),
    ckDates: check('ck_booking_dates', `check_in_date < check_out_date`)
  })
);

// --- Optional typed relations
export const areaRelations = relations(accommodationArea, ({ many }) => ({
  houses: many(house)
}));
export const houseRelations = relations(house, ({ one, many }) => ({
  area: one(accommodationArea, { fields: [house.areaId], references: [accommodationArea.areaId] }),
  rooms: many(room)
}));
export const roomRelations = relations(room, ({ one, many }) => ({
  house: one(house, { fields: [room.houseId], references: [house.houseId] }),
  beds: many(bed)
}));
export const bedRelations = relations(bed, ({ one }) => ({
  room: one(room, { fields: [bed.roomId], references: [room.roomId] })
}));
export const guestRelations = relations(guest, ({ many }) => ({
  bookings: many(booking)
}));
export const bookingRelations = relations(booking, ({ one }) => ({
  bed: one(bed, { fields: [booking.bedId], references: [bed.bedId] }),
  guest: one(guest, { fields: [booking.guestId], references: [guest.guestId] })
}));
