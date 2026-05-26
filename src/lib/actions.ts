"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

const by = "demo-user";

function normalizeDayOfMonths(raw: string): string {
  const days = raw.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);
  return Array.from(new Set(days)).sort((a, b) => a - b).join(",");
}

export async function upsertDestination(formData: FormData) {
  const id = Number(formData.get("id") || 0);
  const values = [formData.get("name"), formData.get("address"), formData.get("phone"), formData.get("contact_name"), formData.get("email"), formData.get("notes"), formData.get("is_active") ? 1 : 0];
  if (!values[0]) return;
  if (id) db.prepare("UPDATE destinations SET name=?,address=?,phone=?,contact_name=?,email=?,notes=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(...values, id);
  else db.prepare("INSERT INTO destinations (name,address,phone,contact_name,email,notes,is_active) VALUES (?,?,?,?,?,?,?)").run(...values);
  revalidatePath("/"); revalidatePath("/calendar"); revalidatePath("/destinations");
  redirect("/destinations");
}

export async function deleteDestination(formData: FormData) { db.prepare("DELETE FROM destinations WHERE id=?").run(Number(formData.get("id"))); revalidatePath("/destinations"); }

export async function upsertUnitSetting(formData: FormData) {
  const id = Number(formData.get("id") || 0);
  const values = [formData.get("category"), formData.get("name"), Number(formData.get("sort_order") || 0), formData.get("is_visible") ? 1 : 0];
  if (!values[0] || !values[1]) return;
  if (id) db.prepare("UPDATE unit_settings SET category=?,name=?,sort_order=?,is_visible=? WHERE id=?").run(...values, id);
  else db.prepare("INSERT INTO unit_settings (category,name,sort_order,is_visible) VALUES (?,?,?,?)").run(...values);
  revalidatePath("/settings/units"); redirect("/settings/units");
}

export async function deleteUnitSetting(formData: FormData) { db.prepare("DELETE FROM unit_settings WHERE id=?").run(Number(formData.get("id"))); revalidatePath("/settings/units"); }

export async function upsertShipment(formData: FormData) {
  const shipmentType = String(formData.get("shipment_type") || "SPOT");
  const recurrenceInput = String(formData.get("recurrence_type") || "NONE");
  const effectiveRecurrenceType = recurrenceInput !== "NONE" ? recurrenceInput : (shipmentType === "REGULAR" ? "WEEKLY" : "NONE");
  const destinationId = Number(formData.get("destination_id"));
  const spec = String(formData.get("spec") || "");
  const quantity = Number(formData.get("quantity") || 0);
  const unit = String(formData.get("unit") || "");
  const memo = String(formData.get("memo") || "");

  if (effectiveRecurrenceType !== "NONE") {
    const normalizedDays = normalizeDayOfMonths(String(formData.get("day_of_months") || formData.get("day_of_month") || "1"));
    const startDate = String(formData.get("start_date") || formData.get("date") || new Date().toISOString().slice(0, 10));
    db.prepare("INSERT INTO recurring_shipments (destination_id,recurrence_type,weekday,day_of_month,day_of_months,start_date,end_date,spec,quantity,unit,memo,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
      .run(destinationId, effectiveRecurrenceType, Number(formData.get("weekday") || 0), Number(formData.get("day_of_month") || 1), normalizedDays, startDate, String(formData.get("end_date") || "") || null, spec, quantity, unit, memo, by);
  } else {
    const id = Number(formData.get("id") || 0);
    const date = String(formData.get("date") || "");
    if (!date) return;
    const values = [date, shipmentType, destinationId, spec, quantity, unit, memo, by];
    if (id) db.prepare("UPDATE shipments SET date=?,shipment_type=?,destination_id=?,spec=?,quantity=?,unit=?,memo=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(...values, id);
    else db.prepare("INSERT INTO shipments (date,shipment_type,destination_id,spec,quantity,unit,memo,updated_by) VALUES (?,?,?,?,?,?,?,?)").run(...values);
  }
  revalidatePath("/"); revalidatePath("/calendar"); redirect("/calendar");
}

export async function upsertRecurringShipment(formData: FormData) {
  const id = Number(formData.get("id") || 0);
  const normalizedDays = normalizeDayOfMonths(String(formData.get("day_of_months") || formData.get("day_of_month") || "1"));
  db.prepare("UPDATE recurring_shipments SET destination_id=?,recurrence_type=?,weekday=?,day_of_month=?,day_of_months=?,start_date=?,end_date=?,spec=?,quantity=?,unit=?,memo=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(Number(formData.get("destination_id")), String(formData.get("recurrence_type")), Number(formData.get("weekday") || 0), Number(formData.get("day_of_month") || 1), normalizedDays, String(formData.get("start_date")), String(formData.get("end_date") || "") || null, String(formData.get("spec") || ""), Number(formData.get("quantity") || 0), String(formData.get("unit") || ""), String(formData.get("memo") || ""), by, id);
  revalidatePath("/"); revalidatePath("/calendar"); redirect("/calendar");
}

export async function deleteShipment(formData: FormData) { db.prepare("DELETE FROM shipments WHERE id=?").run(Number(formData.get("id"))); revalidatePath("/"); revalidatePath("/calendar"); }
export async function deleteRecurringShipment(formData: FormData) { db.prepare("DELETE FROM recurring_shipments WHERE id=?").run(Number(formData.get("id"))); revalidatePath("/"); revalidatePath("/calendar"); redirect("/calendar"); }

export async function upsertEvent(formData: FormData) {
  const id = Number(formData.get("id") || 0);
  const values = [formData.get("date"), formData.get("time") || "", formData.get("title"), formData.get("memo") || "", by];
  if (id) db.prepare("UPDATE events SET date=?,time=?,title=?,memo=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(...values, id);
  else db.prepare("INSERT INTO events (date,time,title,memo,updated_by) VALUES (?,?,?,?,?)").run(...values);
  revalidatePath("/"); revalidatePath("/calendar"); redirect("/calendar");
}

export async function deleteEvent(formData: FormData) { db.prepare("DELETE FROM events WHERE id=?").run(Number(formData.get("id"))); revalidatePath("/"); revalidatePath("/calendar"); }

export async function upsertMemo(formData: FormData) {
  const id = Number(formData.get("id") || 0);
  const values = [formData.get("date"), formData.get("content"), Number(formData.get("priority") || 2), by];
  if (id) db.prepare("UPDATE memos SET date=?,content=?,priority=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(...values, id);
  else db.prepare("INSERT INTO memos (date,content,priority,updated_by) VALUES (?,?,?,?)").run(...values);
  revalidatePath("/"); revalidatePath("/calendar"); redirect("/calendar");
}

export async function deleteMemo(formData: FormData) { db.prepare("DELETE FROM memos WHERE id=?").run(Number(formData.get("id"))); revalidatePath("/"); revalidatePath("/calendar"); }
