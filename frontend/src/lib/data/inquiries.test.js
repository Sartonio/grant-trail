// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

vi.mock('../../supabaseClient', () => ({ supabase: { rpc: rpcMock, from: fromMock } }));

import { acceptSponsorshipInquiry, updateInquiryStatus, listInquiriesForListing } from './inquiries';

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

describe('listInquiriesForListing', () => {
  it('selects the listing inquiries by numeric id, newest first', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    fromMock.mockReturnValue({ select });

    await listInquiriesForListing('5');
    expect(fromMock).toHaveBeenCalledWith('sponsorship_inquiries');
    expect(select).toHaveBeenCalledWith('*');
    expect(eq).toHaveBeenCalledWith('listing_id', 5);
    expect(order).toHaveBeenCalledWith('submitted_at', { ascending: false });
  });
});

describe('updateInquiryStatus', () => {
  const mockUpdateChain = (result) => {
    const select = vi.fn().mockResolvedValue(result);
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    fromMock.mockReturnValue({ update });
    return { update, eq, select };
  };

  it('updates the inquiry row by numeric id and returns the updated rows', async () => {
    const { update, eq } = mockUpdateChain({ data: [{ id: 3 }], error: null });

    const rows = await updateInquiryStatus('3', 'declined');
    expect(fromMock).toHaveBeenCalledWith('sponsorship_inquiries');
    expect(update).toHaveBeenCalledWith({ status: 'declined' });
    expect(eq).toHaveBeenCalledWith('id', 3);
    expect(rows).toEqual([{ id: 3 }]);
  });

  it('throws the RLS message when no rows are updated', async () => {
    mockUpdateChain({ data: [], error: null });
    await expect(updateInquiryStatus('3', 'declined')).rejects.toThrow(
      /check RLS policies for sponsorship_inquiries/
    );
  });

  it('throws the supabase error when the update fails', async () => {
    const boom = new Error('rls boom');
    mockUpdateChain({ data: null, error: boom });
    await expect(updateInquiryStatus('3', 'reviewing')).rejects.toBe(boom);
  });
});
