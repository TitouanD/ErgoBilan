// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PatientIdentityBar } from './PatientIdentityBar';
import { fictivePatient } from '../../../dev/testing';

describe('PatientIdentityBar (#116)', () => {
  it('reminds the first name, last name, age in years and months and current class', () => {
    const patient = fictivePatient('leo', { dob: '2018-03-20', classLevel: 'CE2' });
    render(<PatientIdentityBar patient={patient} assessmentDate="2026-10-01T10:00:00.000Z" />);
    const bar = screen.getByTestId('patient-identity-bar');
    expect(bar).toHaveTextContent(`${patient.firstName} ${patient.lastName}`);
    expect(bar).toHaveTextContent('8 ans 6 mois');
    expect(bar).toHaveTextContent('CE2');
  });

  it('computes the age at the assessment date and lets the practitioner change that date (#153)', () => {
    const onChange = vi.fn();
    const patient = fictivePatient('leo', { dob: '2018-03-20', age: '8 ans 7 mois' });
    render(<PatientIdentityBar patient={patient} assessmentDate="2026-09-10T10:00:00.000Z" onAssessmentDateChange={onChange} />);
    expect(screen.getByTestId('patient-identity-bar')).toHaveTextContent('8 ans 5 mois');

    const input = screen.getByTestId('assessment-date');
    expect(input).toHaveValue('2026-09-10');
    fireEvent.change(input, { target: { value: '2026-09-25' } });
    expect(onChange).toHaveBeenCalledWith(new Date('2026-09-25').toISOString());
  });

  it('says when the class is missing', () => {
    render(<PatientIdentityBar patient={fictivePatient('leo', { classLevel: '' })} />);
    expect(screen.getByTestId('patient-identity-bar')).toHaveTextContent('Classe non renseignée');
  });

  it('renders nothing before the child is named', () => {
    const { container } = render(<PatientIdentityBar patient={fictivePatient('leo', { firstName: '', lastName: '' })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
