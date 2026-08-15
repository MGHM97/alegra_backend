import { describe, it, expect, afterAll } from 'vitest';
import supertest from 'supertest';
import { getApp, closeApp } from './setup.js';

function api() {
  return getApp().then((app) => supertest(app.server));
}

const MANAUS_ZIP = '69000-000';
const SP_ZIP = '01310-100';

interface ShippingOptionDto {
  id: string;
  name: string;
  price: number;
  estimatedDays: number;
  carrier: string;
}

interface ShippingResponseBody {
  status: 'success';
  data: ShippingOptionDto[];
  meta: {
    freeShipping: {
      threshold: number;
      remaining: number;
      eligible: boolean;
      zone: 'local' | 'national';
    };
  };
}

function cheapestNonPickup(options: ShippingOptionDto[]): ShippingOptionDto {
  return options
    .filter((option) => option.id !== 'store-pickup')
    .reduce((min, option) => (option.price < min.price ? option : min));
}

describe('POST /v1/shipping/calculate — progressive free shipping', () => {
  afterAll(async () => {
    await closeApp();
  });

  it('Manaus (local zone) below threshold: cheapest non-pickup option stays paid, remaining reflects the gap', async () => {
    const agent = await api();
    const res = await agent
      .post('/v1/shipping/calculate')
      .send({ zipCode: MANAUS_ZIP, subtotal: 100 });

    expect(res.status).toBe(200);
    const body = res.body as ShippingResponseBody;

    expect(body.meta.freeShipping.zone).toBe('local');
    expect(body.meta.freeShipping.eligible).toBe(false);
    expect(body.meta.freeShipping.threshold).toBe(150);
    expect(body.meta.freeShipping.remaining).toBe(50);

    const cheapest = cheapestNonPickup(body.data);
    expect(cheapest.price).toBeGreaterThan(0);
    expect(cheapest.name.includes('Frete grátis')).toBe(false);
  });

  it('Manaus (local zone) at/above threshold: cheapest non-pickup option becomes free and eligible is true', async () => {
    const agent = await api();
    const res = await agent
      .post('/v1/shipping/calculate')
      .send({ zipCode: MANAUS_ZIP, subtotal: 200 });

    expect(res.status).toBe(200);
    const body = res.body as ShippingResponseBody;

    expect(body.meta.freeShipping.zone).toBe('local');
    expect(body.meta.freeShipping.eligible).toBe(true);
    expect(body.meta.freeShipping.remaining).toBe(0);

    const cheapest = cheapestNonPickup(body.data);
    expect(cheapest.price).toBe(0);
    expect(cheapest.name.endsWith('Frete grátis')).toBe(true);

    // store-pickup stays free and untouched regardless of eligibility.
    const pickup = body.data.find((option) => option.id === 'store-pickup');
    expect(pickup?.price).toBe(0);
    expect(pickup?.name).toBe('Retirar na loja');
  });

  it('national zone above threshold: cheapest non-pickup (Correios) option becomes free', async () => {
    const agent = await api();
    const res = await agent
      .post('/v1/shipping/calculate')
      .send({ zipCode: SP_ZIP, subtotal: 500 });

    expect(res.status).toBe(200);
    const body = res.body as ShippingResponseBody;

    expect(body.meta.freeShipping.zone).toBe('national');
    expect(body.meta.freeShipping.threshold).toBe(400);
    expect(body.meta.freeShipping.eligible).toBe(true);
    expect(body.meta.freeShipping.remaining).toBe(0);

    const cheapest = cheapestNonPickup(body.data);
    expect(cheapest.price).toBe(0);
    expect(cheapest.name.endsWith('Frete grátis')).toBe(true);

    // Only one non-pickup option should have been zeroed out.
    const freeCount = body.data.filter((option) => option.price === 0).length;
    expect(freeCount).toBe(2); // store-pickup + the one free delivery option
  });

  it('without subtotal: meta.freeShipping still comes back, remaining equals the zone threshold, not eligible', async () => {
    const agent = await api();
    const res = await agent.post('/v1/shipping/calculate').send({ zipCode: SP_ZIP });

    expect(res.status).toBe(200);
    const body = res.body as ShippingResponseBody;

    expect(body.meta.freeShipping.eligible).toBe(false);
    expect(body.meta.freeShipping.remaining).toBe(body.meta.freeShipping.threshold);
    expect(body.meta.freeShipping.threshold).toBe(400);

    // No option should be marked free when subtotal is absent.
    const cheapest = cheapestNonPickup(body.data);
    expect(cheapest.price).toBeGreaterThan(0);
  });
});
