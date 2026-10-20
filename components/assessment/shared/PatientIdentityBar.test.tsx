// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PatientIdentityBar } from './PatientIdentityBar';
import { fictivePatient } from '../../../dev/testing';

describe('PatientIdentityBar (#116)', () => {
  it('reminds the first name, last name, age in years and months and current class', () => {
    const patient = fictivePatient('leo', { dob: '2018-03-20', classLevel: 'CE2' });
    render(<PatientIdentityBar patient={patient} referenceDate={new Date(2026, 9, 1)} />);
    const bar = screen.getByTestId('patient-identity-bar');
    expect(bar).toHaveTextContent(`${patient.firstName} ${patient.lastName}`);
    expect(bar).toHaveTextContent('8 ans 6 mois');
    expect(bar).toHaveTextContent('CE2');
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
