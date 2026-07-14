import { DateTime } from "luxon";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import Message from "@/models/Message";
import { sendSms } from "@/lib/twilio/sendSMS";
import { sendEmail } from "@/lib/email";
import { runScheduleAppointmentTool } from "@/lib/ai/assistant/scheduleAppointmentTool";

jest.mock("@/lib/mongooseConnect", () => jest.fn());
jest.mock("@/lib/twilio/sendSMS", () => ({ sendSms: jest.fn().mockResolvedValue({}) }));
jest.mock("@/lib/email", () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  renderAgentBookingEmail: jest.fn().mockReturnValue("<html></html>"),
}));
jest.mock("@/lib/analytics/recordLeadOutcome", () => ({ recordLeadOutcome: jest.fn().mockResolvedValue(undefined) }));

jest.mock("@/models/User", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("@/models/Lead", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("@/models/Folder", () => ({ __esModule: true, default: { findOneAndUpdate: jest.fn() } }));
jest.mock("@/models/Message", () => ({ __esModule: true, default: { create: jest.fn().mockResolvedValue({}) } }));

const mockCalendarInsert = jest.fn();
const mockCalendarsGet = jest.fn().mockResolvedValue({ data: { timeZone: "America/Phoenix" } });
jest.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: jest.fn().mockImplementation(() => ({ setCredentials: jest.fn() })) },
    calendar: jest.fn().mockImplementation(() => ({
      calendars: { get: (...args: any[]) => mockCalendarsGet(...args) },
      events: { insert: (...args: any[]) => mockCalendarInsert(...args) },
    })),
  },
}));

const mockedUser = User as unknown as { findOne: jest.Mock };
const mockedLead = Lead as unknown as { findOne: jest.Mock; save?: jest.Mock };
const mockedFolder = Folder as unknown as { findOneAndUpdate: jest.Mock };

const FUTURE_START = DateTime.utc().plus({ days: 2 }).toISO();
const FUTURE_END = DateTime.utc().plus({ days: 2, minutes: 30 }).toISO();

function connectedUser(overrides: Record<string, any> = {}) {
  return {
    email: "agent@example.com",
    name: "Agent Smith",
    googleTokens: { refreshToken: "rt", access_token: "at" },
    numbers: [{ phoneNumber: "+18005551234" }],
    ...overrides,
  };
}

function leadDoc(overrides: Record<string, any> = {}) {
  return {
    _id: "507f1f77bcf86cd799439011",
    "First Name": "Jane",
    "Last Name": "Doe",
    Phone: "+18085551212",
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("schedule_appointment tool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFolder.findOneAndUpdate.mockResolvedValue({ _id: "folder1", name: "Booked Appointment" });
    mockCalendarInsert.mockResolvedValue({ data: { id: "evt1", htmlLink: "https://calendar.google.com/evt1" } });
  });

  test("requires leadId/startISO/endISO", async () => {
    const result = await runScheduleAppointmentTool("agent@example.com", {} as any);
    expect(result.scheduled).toBe(false);
  });

  test("unauthenticated (no session email) is rejected before touching the DB", async () => {
    const result = await runScheduleAppointmentTool("", { leadId: "x", startISO: FUTURE_START, endISO: FUTURE_END });
    expect(result.scheduled).toBe(false);
    expect(mockedUser.findOne).not.toHaveBeenCalled();
  });

  test("lead not owned by the caller (tenant scoping) fails instead of booking", async () => {
    mockedUser.findOne.mockResolvedValue(connectedUser());
    mockedLead.findOne.mockResolvedValue(null); // Lead.findOne({_id, userEmail}) found nothing

    const result = await runScheduleAppointmentTool("agent@example.com", {
      leadId: "not-mine",
      startISO: FUTURE_START,
      endISO: FUTURE_END,
    });

    expect(mockedLead.findOne).toHaveBeenCalledWith({ _id: "not-mine", userEmail: "agent@example.com" });
    expect(result.scheduled).toBe(false);
    expect(mockCalendarInsert).not.toHaveBeenCalled();
  });

  test("Google Calendar not connected fails cleanly", async () => {
    mockedUser.findOne.mockResolvedValue(connectedUser({ googleTokens: undefined, googleSheets: undefined }));

    const result = await runScheduleAppointmentTool("agent@example.com", {
      leadId: "507f1f77bcf86cd799439011",
      startISO: FUTURE_START,
      endISO: FUTURE_END,
    });

    expect(result.scheduled).toBe(false);
    expect(mockCalendarInsert).not.toHaveBeenCalled();
  });

  test("a past start time is rejected", async () => {
    mockedUser.findOne.mockResolvedValue(connectedUser());
    mockedLead.findOne.mockResolvedValue(leadDoc());

    const past = DateTime.utc().minus({ days: 1 }).toISO();
    const result = await runScheduleAppointmentTool("agent@example.com", {
      leadId: "507f1f77bcf86cd799439011",
      startISO: past!,
      endISO: FUTURE_END,
    });

    expect(result.scheduled).toBe(false);
    expect(mockCalendarInsert).not.toHaveBeenCalled();
  });

  test("happy path books the calendar event, texts the lead, and moves the lead to Booked Appointment", async () => {
    mockedUser.findOne.mockResolvedValue(connectedUser());
    const lead = leadDoc();
    mockedLead.findOne.mockResolvedValue(lead);

    const result = await runScheduleAppointmentTool("agent@example.com", {
      leadId: "507f1f77bcf86cd799439011",
      startISO: FUTURE_START,
      endISO: FUTURE_END,
      title: "Follow-up call",
    });

    expect(result.scheduled).toBe(true);
    if (result.scheduled) {
      expect(result.eventId).toBe("evt1");
    }
    expect(mockCalendarInsert).toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+18085551212", userEmail: "agent@example.com", source: "booking_confirmation" }),
    );
    expect(lead.folderId).toBe("folder1");
    expect(lead.status).toBe("Booked Appointment");
    expect(lead.save).toHaveBeenCalled();
  });
});
