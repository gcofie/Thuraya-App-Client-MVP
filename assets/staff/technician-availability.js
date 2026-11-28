'use strict';
// A read-only projection of the existing Staff scheduling and conflict authority.
// No attendance, financial or booking writer lives in this view.
(function(root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else { root.ThurayaTechnicianAvailability = api; api.install(); }
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
    const norm = value => String(value || '').trim().toLowerCase();
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const format = minute => `${String(Math.floor(minute / 60)).padStart(2,'0')}:${String(minute % 60).padStart(2,'0')}`;
    function clock(now = new Date()) {
        const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Accra',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
        const p = Object.fromEntries(parts.map(x => [x.type,x.value]));
        return {date:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)};
    }
    function merge(intervals) {
        const result=[];
        for (const pair of intervals.map(x => x.slice(0,2)).sort((a,b)=>a[0]-b[0])) {
            if (!Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || pair[0] >= pair[1]) throw Error('Invalid occupied period.');
            const last=result.at(-1);
            if(last && pair[0]<=last[1]) last[1]=Math.max(last[1],pair[1]); else result.push(pair);
        }
        return result;
    }
    function freePeriods(schedule,busy,window) {
        if(!schedule?.worksToday) return [];
        const result=[];
        for(const period of schedule.periods || [{startMins:schedule.startMins,endMins:schedule.endMins}]) {
            let cursor=Math.max(period.startMins,window[0]);const end=Math.min(period.endMins,window[1]);
            for(const [start,stop] of merge(busy)) {
                if(stop<=cursor || start>=end) continue;
                if(start>cursor) result.push([cursor,Math.min(start,end)]);
                cursor=Math.max(cursor,stop);
            }
            if(cursor<end) result.push([cursor,end]);
        }
        return merge(result);
    }
    function eligible(tech,service) {
        if(!service) return true;
        const dept=norm(service.department);
        if(!['hand','foot','both'].includes(dept)) return false;
        // Reuse the Staff Matrix policy, including its legacy Both default.
        return Array.isArray(tech.therapyTypes) && (dept==='both' ? ['hand','foot'].every(d=>tech.therapyTypes.includes(d)) : tech.therapyTypes.includes(dept));
    }
    function slots(schedule,busy,window,duration,date,time,now,prep=0) {
        if(!Number.isInteger(duration)||duration<=0) return [];
        const result=[];
        const free=freePeriods(schedule,busy,window);
        for(const period of schedule?.worksToday ? schedule.periods || [schedule] : []) {
            const start=Math.max(period.startMins,window[0]),end=Math.min(period.endMins,window[1]);
            for(let t=start;t+duration+prep<=end;t+=15) {
                if(!free.some(p=>t>=p[0]&&t+duration+prep<=p[1])) continue;
                if(date===now.date && t<=now.minute+10) continue;
                if(time!==null && time!==undefined && t!==time) continue;
                result.push(format(t));
            }
        }
        return result;
    }
    let generation=0, currentModel=null, mounted=false;
    const q=id=>root.document?.getElementById(id);
    function session() {
        if(!root.ThurayaSessionResources?.capture) throw Error('Authenticated Staff session unavailable.');
        const valid=root.ThurayaSessionResources.capture();
        if(!valid()) throw Error('Authenticated Staff session ended.');
        return valid;
    }
    async function read(query,valid) {
        const snap=await query.get({source:'server'});
        if(!valid()) throw Error('Authenticated Staff session ended.');
        if(snap.metadata?.fromCache) throw Error('Fresh availability is unavailable.');
        if(snap.size>1000) throw Error('Availability input limit reached; complete data is required.');
        return snap;
    }
    const rows=snap=>snap.docs.map(doc=>({...doc.data(),id:doc.id}));
    async function load(date,valid=session()) {
        const policy=root.ThurayaAvailabilitySchedulePolicy;
        if(!policy?.calendarDate(date)||date<clock().date) throw Error('Choose today or a future date.');
        if(typeof root.thurayaAvailabilitySources.schedules!=='function' || typeof root.thurayaAvailabilitySources.busy!=='function' || typeof root.thurayaAvailabilitySources.normalizeMenu!=='function') throw Error('Existing scheduling authority unavailable.');
        const db=root.db;
        const [users,menu,leaves,blocks,settings] = await Promise.all([
            read(db.collection('Users').limit(1001),valid),read(db.collection('Menu_Settings_V2').limit(1001),valid),
            read(db.collection('Staff_Leave').where('status','==','Approved').limit(1001),valid),read(db.collection('Calendar_Blocks').limit(1001),valid),
            read(db.collection('Settings').doc('operations_engine'),valid)
        ]);
        if(!settings.exists) throw Error('Booking settings could not be verified.');
        const config=settings.data();
        const open=config.bookingWindowStartTime?policy.minutes(config.bookingWindowStartTime):0;
        const close=config.bookingWindowEndTime?policy.minutes(config.bookingWindowEndTime):1440;
        if(!Number.isInteger(open)||!Number.isInteger(close)||open>=close) throw Error('Booking window is invalid.');
        const prep=config.applyPrepTimeToAvailability===false?0:Number(config.prepTimeMinutes ?? 10);
        if(!Number.isInteger(prep)||prep<0||prep>1440) throw Error('Prep time is invalid.');
        const technicians=rows(users).filter(u=>!root.__THURAYA_AVAILABILITY_QUALIFICATION__||root.__THURAYA_AVAILABILITY_QUALIFICATION__.technicians.includes(u.id)).filter(u=>u.active!==false && u.disabled!==true && !['inactive','disabled','archived','terminated'].includes(norm(u.status)) && (Array.isArray(u.roles)?u.roles:[u.role]).some(r=>/^(tech|technician|test tech)$/i.test(String(r||'').trim()))).map(u=>({email:u.id,name:u.name||'Technician',therapyTypes:root.normalizeTherapyTypes(u)}));
        const [schedules,busy]=await Promise.all([
            root.thurayaAvailabilitySources.schedules(date,technicians.map(t=>t.email)),
            root.thurayaAvailabilitySources.busy(date,{strict:true,includeAttendance:false,prepMinutes:prep})
        ]);
        if(!valid()) throw Error('Authenticated Staff session ended.');
        const occupied=new Map();
        for(const tech of technicians) {
            const periods=(busy.get(norm(tech.email))||busy.get(tech.email)||[]).map(x=>x.slice(0,2));
            for(const leave of rows(leaves)) if(norm(leave.techEmail)===norm(tech.email)&&leave.startDate<=date&&leave.endDate>=date) periods.push([0,1440]);
            for(const block of rows(blocks)) {
                if(block.techEmail && norm(block.techEmail)!==norm(tech.email)) continue;
                if(block.dateString!==date && !(block.rangeStart<=date && block.rangeEnd>=date)) continue;
                if(['full_day','tech_specific','date_range'].includes(block.type)) periods.push([0,1440]);
                else if(block.type==='time_range') {
                    const start=policy.minutes(block.startTime),end=policy.minutes(block.endTime);
                    if(!Number.isInteger(start)||!Number.isInteger(end)||start>=end) throw Error('Calendar block could not be verified.');
                    periods.push([start,end]);
                } else throw Error('Calendar block type could not be verified.');
            }
            occupied.set(norm(tech.email),merge(periods));
        }
        const services=rows(menu).map((s,i)=>root.thurayaAvailabilitySources.normalizeMenu(s,i)).filter(s=>s.isActive&&s.deleted!==true&&Number.isInteger(s.duration)&&s.duration>0).map(s=>({id:s.id,serviceName:s.serviceName,department:s.department,duration:s.duration}));
        const presence=new Map();
        if(date===clock().date && root.thurayaAttendance?.fetchDayAggregates) {
            try {
                const report=await root.thurayaAttendance.fetchDayAggregates(db,date);
                if(!valid()) throw Error('Authenticated Staff session ended.');
                report?.aggregates?.forEach(a=>presence.set(norm(a.email||a.technicianKey),a.multipleOpen?'Attendance needs review':a.isPresent?(a.onLunch?'Present · on lunch':'Present'):a.workedToday?'Clocked out':'Not clocked in'));
            } catch(error) { if(!valid()) throw error; /* Optional attendance never creates booking capacity. */ }
        }
        return {date,technicians,services,schedules,occupied,presence,window:[open,close],prep};
    }
    function selectedServices(model) {
        const inputs=Array.from(root.document.querySelectorAll('#sched_serviceMenu .sched-service-item:checked, #sched_serviceMenu .sched-service-counter')).filter(el=>el.matches('.sched-service-item')||Number(el.value)>0);
        return inputs.map(el=> {
            const id=String(el.id||'').replace(/^sched_(?:qty|cb)_/,'');
            const matches=model.services.filter(s=>s.id===id || s.serviceName===el.getAttribute('data-name'));
            const service=matches.find(s=>s.id===id) || (matches.length===1?matches[0]:null);
            if(!service) throw Error('Selected treatment eligibility could not be verified.');
            return service;
        });
    }
    async function validate(assignments) {
        const valid=session();
        for(const row of assignments) {
            const model=await load(row.date,valid);const tech=model.technicians.find(t=>norm(t.email)===norm(row.techEmail));
            if(!tech) throw Error('Technician could not be verified.');
            const start=root.ThurayaAvailabilitySchedulePolicy.minutes(row.time),duration=Number(row.duration);
            if(!root.ThurayaAvailabilitySchedulePolicy.check(model.schedules[norm(tech.email)],row.date,row.time,duration).ok ||
                !slots(model.schedules[norm(tech.email)],model.occupied.get(norm(tech.email)),model.window,duration,row.date,start,clock(),model.prep).includes(row.time)) throw Error('The selected slot is no longer available. Choose another time.');
            if(selectedServices(model).some(s=>!eligible(tech,s))) throw Error('This technician is not eligible for the selected treatment.');
        }
        if(!valid()) throw Error('Authenticated Staff session ended.');
        return true;
    }
    function clear() { generation++;currentModel=null;root.__thurayaAvailabilityBooking=null; if(q('thAvailabilityRows')) q('thAvailabilityRows').replaceChildren(); if(q('thAvailabilityService')) q('thAvailabilityService').innerHTML='<option value="">All treatments</option>'; }
    async function refresh() {
        const token=++generation;currentModel=null;const host=q('thAvailabilityRows');if(!host) return;
        host.textContent='Checking current scheduling and occupied periods…';
        let valid;
        try {
            valid=session();const date=q('thAvailabilityDate').value;const model=await load(date,valid);
            if(token!==generation||!valid()) return;
            const select=q('thAvailabilityService'),previous=select.value;
            select.innerHTML='<option value="">All treatments</option>'+model.services.map(s=>`<option value="${esc(s.id)}">${esc(s.serviceName)}</option>`).join('');
            select.value=previous;currentModel=model;render();
        } catch(error) { if(token===generation && (!valid||valid())) host.textContent='Availability not verified. '+error.message; }
    }
    function render() {
        const model=currentModel;if(!model) return;
        const service=model.services.find(s=>s.id===q('thAvailabilityService').value);
        const duration=service?service.duration:Number(q('thAvailabilityDuration').value);
        const preferred=q('thAvailabilityTime').value;const time=preferred?root.ThurayaAvailabilitySchedulePolicy.minutes(preferred):null;
        const now=clock();
        q('thAvailabilityRows').innerHTML=model.technicians.map(tech=> {
            const schedule=model.schedules[norm(tech.email)],busy=model.occupied.get(norm(tech.email));
            const fits=eligible(tech,service);const available=fits?slots(schedule,busy,model.window,duration,model.date,time,now,model.prep):[];
            const shifts=schedule?.worksToday?(schedule.periods||[{startMins:schedule.startMins,endMins:schedule.endMins}]).map(p=>`${format(p.startMins)}–${format(p.endMins)}`).join(', '):schedule?.reason==='OFF_DAY'?'Off day':'Schedule unverified';
            const free=freePeriods(schedule,busy,model.window).map(p=>`${format(p[0])}–${format(p[1])}`).join(', ')||'None';
            return `<article class="th-availability-tech"><h4>${esc(tech.name)}</h4><p><strong>Shift(s):</strong> ${esc(shifts)}</p><p><strong>Attendance:</strong> ${esc(model.date===now.date?(model.presence.get(norm(tech.email))||'Not verified'):'Not applicable for future date')} (separate from bookability)</p><p><strong>Occupied:</strong> ${busy.map(p=>`${format(p[0])}–${format(p[1])}`).join(', ')||'None'}</p><p><strong>Available periods:</strong> ${esc(free)}</p><p>${!fits?'Not eligible for selected treatment':available.length?`Next available: ${available[0]}`:'No matching slot'}</p><div class="th-availability-slots">${available.map(t=>`<button type="button" class="btn btn-secondary" data-availability-book="${esc(tech.email)}" data-time="${t}">${t} · Book</button>`).join('')}</div></article>`;
        }).join('')||'<p>No active technicians found.</p>';
    }
    async function openBooking(email,time) {
        const model=currentModel;if(!model) return;const valid=session();
        const selectedId=q('thAvailabilityService').value;
        const fresh=await load(model.date,valid);const tech=fresh.technicians.find(t=>norm(t.email)===norm(email));
        const service=fresh.services.find(s=>s.id===selectedId);
        if(selectedId&&!service) throw Error('Treatment is no longer published. Refresh availability.');
        const duration=service?service.duration:Number(q('thAvailabilityDuration').value);
        if(!tech || !eligible(tech,service) || !slots(fresh.schedules[norm(email)],fresh.occupied.get(norm(email)),fresh.window,duration,model.date,root.ThurayaAvailabilitySchedulePolicy.minutes(time),clock(),fresh.prep).includes(time)) throw Error('The selected slot changed. Refresh availability.');
        if(!valid() || model!==currentModel) return;
        if(root.thurayaHasAppointmentEdit?.()) throw Error('Close the existing appointment edit before starting a new booking.');
        root.switchModule('bookingWizardView');
        root.thHF84SetMode?.('individual');
        root.__thurayaAvailabilityBooking={date:model.date,techEmail:email};
        const nav=q('nav_new_booking');if(nav)nav.checked=true;
        const dateInput=q('sched_date'),techInput=q('sched_techSelect'),timeInput=q('sched_time');
        if(!dateInput||!techInput||!timeInput) throw Error('Existing New Booking is not ready.');
        dateInput.value=model.date;techInput.value=email;
        if(techInput.value!==email) throw Error('Technician is no longer available in New Booking.');
        const menuInputs=Array.from(root.document.querySelectorAll('#sched_serviceMenu .sched-service-item, #sched_serviceMenu .sched-service-counter'));
        menuInputs.forEach(el=>{if(el.matches('.sched-service-counter'))el.value='0';else el.checked=false;});
        if(service) {
            const input=menuInputs.find(el=>el.id==='sched_cb_'+service.id||el.id==='sched_qty_'+service.id) || (fresh.services.filter(s=>s.serviceName===service.serviceName).length===1?menuInputs.find(el=>el.getAttribute('data-name')===service.serviceName):null);
            if(!input) throw Error('Treatment is unavailable in New Booking.');
            if(input.matches('.sched-service-counter')) input.value='1';else input.checked=true;
            root.calculateScheduleTotals?.();
        }
        await root.generateTimeSlots?.();
        if(!valid()) return;
        // Keep the exact suggestion; saving uses the actual selected duration and fresh authority.
        timeInput.value=time;root.thHF84Refresh?.();
        root.thHF84SetStep?.(service?1:2);
    }
    function mount() {
        if(mounted||!q('clientsView')) return;
        const tabs=q('clientsView').querySelector('.category-tabs');if(!tabs)return;mounted=true;
        const label=root.document.createElement('label');label.innerHTML='<input type="radio" name="clients_view_toggle" value="availability"> Technician Availability';tabs.appendChild(label);
        const panel=root.document.createElement('section');panel.id='subView_Availability';panel.hidden=true;
        panel.innerHTML='<div class="module-box"><h3>Technician Availability</h3><p>One view for today and future dates. Scheduled, present and bookable are separate.</p><div class="th-availability-filters"><label>Date<input id="thAvailabilityDate" type="date"></label><label>Treatment<select id="thAvailabilityService"><option value="">All treatments</option></select></label><label>Duration (minutes)<input id="thAvailabilityDuration" type="number" min="1" max="1440" value="60"></label><label>Preferred time<input id="thAvailabilityTime" type="time" step="900"></label><button type="button" class="btn" id="thAvailabilityRefresh">Refresh</button></div><p>No customer details are shown. Availability is rechecked before booking is saved.</p><div id="thAvailabilityRows" aria-live="polite"></div></div>';
        q('clientsView').appendChild(panel);q('thAvailabilityDate').value=clock().date;q('thAvailabilityDate').min=clock().date;
        label.querySelector('input').addEventListener('change',()=>root.toggleClientsSubView());
        const previous=root.toggleClientsSubView;
        root.toggleClientsSubView=function() {
            const active=root.document.querySelector('input[name="clients_view_toggle"]:checked')?.value==='availability';
            if(active) { q('clientsView').querySelectorAll('[id^="subView_"]').forEach(el=>el.style.display='none');panel.hidden=false;panel.style.display='block';refresh(); }
            else { panel.hidden=true;panel.style.display='none';return previous?.apply(this,arguments); }
        };
        q('thAvailabilityRefresh').addEventListener('click',refresh);
        q('thAvailabilityDate').addEventListener('change',refresh);
        ['thAvailabilityService','thAvailabilityTime','thAvailabilityDuration'].forEach(id=>q(id).addEventListener('change',render));
        panel.addEventListener('click',event=> {const button=event.target.closest('[data-availability-book]');if(button) openBooking(button.dataset.availabilityBook,button.dataset.time).catch(error=>{if(q('thAvailabilityRows'))q('thAvailabilityRows').textContent=error.message;});});
    }
    function install() {
        root.thurayaValidateBookingAvailability=validate;
        const navigate=root.switchModule;
        if(typeof navigate==='function') root.switchModule=function(){
            if(root.__thurayaAvailabilityBooking) {root.__thurayaAvailabilityBooking=null;if(q('sched_time'))q('sched_time').value='';}
            return navigate.apply(this,arguments);
        };
        const cancel=root.cancelEditMode;
        if(typeof cancel==='function') root.cancelEditMode=function(){root.__thurayaAvailabilityBooking=null;return cancel.apply(this,arguments);};
        const group=root.thHF87OpenGroup;
        if(typeof group==='function') root.thHF87OpenGroup=function(){root.__thurayaAvailabilityBooking=null;return group.apply(this,arguments);};
        root.ThurayaSessionResources?.onStop('technician-availability',clear);
        if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',mount);else mount();
    }
    return Object.freeze({clock,merge,freePeriods,eligible,slots,load,validate,refresh,render,openBooking,install,clear});
});
