import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

vi.mock('../../supabaseClient', () => ({ supabase: { rpc: rpcMock, from: fromMock } }));

import { acceptSponsorshipInquiry, updateInquiryStatus } from './inquiries';

beforeEach(() => {
  rpcMock.mockReset().mockResolvedValue({
    data: { grant_id: 42, tenant_id: 2, already_accepted: false },
    error: null,
  });
  fromMock.mockReset();
});

describe('acceptSponsorshipInquiry', () => {
  it('calls the accept_sponsorship_inquiry RPC with a numeric inquiry id', async () => {
    const { data, error } = await acceptSponsorshipInquiry('7');
    expect(rpcMock).toHaveBeenCalledWith('accept_sponsorship_inquiry', { p_inquiry_id: 7 });
    expect(error).toBeNull();
    expect(data.grant_id).toBe(42);
  });

  it('surfaces the RPC error untouched', async () => {
    const rpcError = { message: 'Only an admin of the sponsoring tenant can accept this inquiry' };
    rpcMock.mockResolvedValue({ data: null, error: rpcError });
    const { error } = await acceptSponsorshipInquiry(7);
    expect(error).toBe(rpcError);
  });
});

describe('updateInquiryStatus', () => {
  it('updates the inquiry row by numeric id', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    fromMock.mockReturnValue({ update });

    await updateInquiryStatus('3', 'declined');
    expect(fromMock).toHaveBeenCalledWith('sponsorship_inquiries');
    expect(update).toHaveBeenCalledWith({ status: 'declined' });
    expect(eq).toHaveBeenCalledWith('id', 3);
  });
});
