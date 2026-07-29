// Shared "Make Recurring" setup modal — Phase 8.46. Used from the Sales
// Ticket detail page (direct inquiry) once a quote/order exists on the
// ticket, and can be reused from any other surface that has a ticket_id with
// a linked order to use as the recurring line-item template.
import { useState } from "react";
import { Repeat, Loader2 } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { Modal, FormGroup, Input, Select, BtnPrimary, BtnSecondary } from "./UI";

const WEEKDAYS = [
  { value: 0, label: "Monday" }, { value: 1, label: "Tuesday" }, { value: 2, label: "Wednesday" },
  { value: 3, label: "Thursday" }, { value: 4, label: "Friday" }, { value: 5, label: "Saturday" },
  { value: 6, label: "Sunday" },
];

export default function RecurringOrderSetupModal({ ticketId, onClose, onCreated }) {
  const [cadence, setCadence]         = useState("weekly");
  const [weekday, setWeekday]         = useState("0");
  const [dayOfMonth, setDayOfMonth]   = useState("1");
  const [hasEndDate, setHasEndDate]   = useState(false);
  const [endDate, setEndDate]         = useState("");
  const [hasMaxOcc, setHasMaxOcc]     = useState(false);
  const [maxOccurrences, setMaxOccurrences] = useState("");
  const [saving, setSaving]           = useState(false);

  const submit = async () => {
    const body = { ticket_id: ticketId, cadence };
    if (cadence === "monthly") {
      body.day_of_month = parseInt(dayOfMonth, 10);
    } else {
      body.weekday = parseInt(weekday, 10);
    }
    if (hasEndDate && endDate) body.end_date = endDate;
    if (hasMaxOcc && maxOccurrences) body.max_occurrences = parseInt(maxOccurrences, 10);

    setSaving(true);
    try {
      const r = await api.post("/api/recurring-orders", body);
      toast.success(`Recurring order set up — next occurrence notice on ${new Date(r.data.next_run_date).toLocaleDateString("en-ZA")}`);
      onCreated && onCreated(r.data);
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to set up recurring order");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Make This Order Recurring" onClose={onClose}>
      <p className="text-xs text-gray-500 mb-4 flex items-start gap-2">
        <Repeat size={13} className="text-bassani-500 shrink-0 mt-0.5" />
        The customer will be emailed a review link 2 days before each occurrence. Accepting
        confirms the order automatically; Bassani still registers the deposit before it moves
        onto the packing board.
      </p>

      <FormGroup label="Repeats" required>
        <Select value={cadence} onChange={e => setCadence(e.target.value)}>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Every 2 weeks</option>
          <option value="monthly">Monthly</option>
        </Select>
      </FormGroup>

      {cadence !== "monthly" ? (
        <FormGroup label="On" required>
          <Select value={weekday} onChange={e => setWeekday(e.target.value)}>
            {WEEKDAYS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
          </Select>
        </FormGroup>
      ) : (
        <FormGroup label="Day of month" required>
          <Input type="number" min="1" max="28" value={dayOfMonth}
            onChange={e => setDayOfMonth(e.target.value)} placeholder="1-28" />
        </FormGroup>
      )}

      <FormGroup label="End condition (optional)">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={hasEndDate} onChange={e => setHasEndDate(e.target.checked)} className="accent-bassani-600" />
            Stop after a specific date
          </label>
          {hasEndDate && (
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          )}
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={hasMaxOcc} onChange={e => setHasMaxOcc(e.target.checked)} className="accent-bassani-600" />
            Stop after a number of occurrences
          </label>
          {hasMaxOcc && (
            <Input type="number" min="1" value={maxOccurrences}
              onChange={e => setMaxOccurrences(e.target.value)} placeholder="e.g. 12" />
          )}
        </div>
      </FormGroup>

      <div className="flex justify-end gap-2 mt-4">
        <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
        <BtnPrimary onClick={submit} disabled={saving}>
          {saving ? <Loader2 size={13} className="animate-spin mr-1.5" /> : null}
          Set Up Recurring Order
        </BtnPrimary>
      </div>
    </Modal>
  );
}
