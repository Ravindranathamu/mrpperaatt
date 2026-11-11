'use strict';

// Times other than Night Body Wash are editable defaults. Only Service,
// Day Body Wash, Clean Park, and Night Body Wash earn Night Body Wash hours;
// the Workshop and Paint departments earn overtime after their shift finish.
const DEFAULT_DEPARTMENTS = [
  {
    name: 'Service',
    work_start: '07:00',
    work_end: '16:00',
    grace_minutes: 10,
    night_body_wash: true,
  },
  {
    name: 'Day Body Wash',
    work_start: '07:00',
    work_end: '16:00',
    grace_minutes: 10,
    night_body_wash: true,
  },
  {
    name: 'Clean Park',
    work_start: '07:00',
    work_end: '16:00',
    grace_minutes: 10,
    night_body_wash: true,
  },
  {
    name: 'Night Body Wash',
    work_start: '16:00',
    work_end: '21:00',
    grace_minutes: 10,
    night_body_wash: true,
  },
  {
    name: 'Workshop 1',
    work_start: '07:00',
    work_end: '16:00',
    grace_minutes: 10,
    night_body_wash: false,
  },
  {
    name: 'Workshop 2',
    work_start: '07:00',
    work_end: '16:00',
    grace_minutes: 10,
    night_body_wash: false,
  },
  {
    name: 'Paint A',
    work_start: '07:00',
    work_end: '16:00',
    grace_minutes: 10,
    night_body_wash: false,
  },
  {
    name: 'Paint B',
    work_start: '07:00',
    work_end: '16:00',
    grace_minutes: 10,
    night_body_wash: false,
  },
  {
    name: 'Paint C',
    work_start: '07:00',
    work_end: '16:00',
    grace_minutes: 10,
    night_body_wash: false,
  },
];

module.exports = { DEFAULT_DEPARTMENTS };
