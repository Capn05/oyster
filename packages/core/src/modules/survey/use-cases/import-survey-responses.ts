import { z } from 'zod';

import { Email } from '@oyster/types';
import { id } from '@oyster/utils';

import { job } from '@/infrastructure/bull/use-cases/job';
import { db } from '@/infrastructure/database';
import { findMemberByEmail } from '@/modules/member/queries/find-member-by-email';
import { parseCsv } from '@/shared/utils/csv.utils';
import { SurveyResponse } from '../survey.types';

const SurveyResponseRecord = z.object({
  Email: Email,
  'First Name': SurveyResponse.shape.firstName,
  'Last Name': SurveyResponse.shape.lastName,
  'Responded On': SurveyResponse.shape.respondedOn,
});

export async function importSurveyResponses(
  surveyId: string,
  csvString: string
) {
  const records = await parseCsv(csvString);

  const responses = await Promise.all(
    records.map(async (record, i) => {
      const result = SurveyResponseRecord.safeParse(record);

      if (!result.success) {
        throw new Error(
          `There was an error parsing row #${i} (${record.Email}).`
        );
      }

      const {
        Email: email,
        'First Name': firstName,
        'Last Name': lastName,
        'Responded On': respondedOn,
      } = result.data;

      const student = await findMemberByEmail(email)
        .select(['students.id'])
        .executeTakeFirst();

      return SurveyResponse.pick({
        email: true,
        firstName: true,
        id: true,
        lastName: true,
        respondedOn: true,
        studentId: true,
        surveyId: true,
      }).parse({
        email,
        firstName,
        id: id(),
        lastName,
        respondedOn,
        studentId: student?.id,
        surveyId,
      });
    })
  );

  await db
    .insertInto('surveyResponses')
    .values(responses)
    .onConflict((oc) => oc.doNothing())
    .execute();

  responses.forEach((response) => {
    if (response.studentId) {
      job('survey.responded', {
        studentId: response.studentId,
        surveyId: response.surveyId,
      });
    }
  });

  return {
    count: responses.length,
  };
}
