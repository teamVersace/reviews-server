var pool = require('../db/postgres.js');

module.exports = {
  getReviews: (id, cb) => {
    console.log('models id', id);
    let reviews = {
      product: id,
      page: 0,
      count: 0,
      results: []
    };

    pool
      .query(`
        SELECT r.*, JSON_AGG(JSON_BUILD_OBJECT('id', p.id, 'url', p.url)) AS photos
        FROM reviews r
          LEFT JOIN photos p
          ON r.id = p.review_id
        WHERE r.product_id = ${id} AND r.reported = false
        GROUP BY r.id;
      `)
      .then(({ rows }) => {
        rows.forEach((review) => {
          let reviewObj = {
            review_id: review.id,
            rating: review.rating,
            summary: review.summary,
            recommend: review.recommend,
            response: review.response,
            body: review.body,
            date: review.date,
            reviewer_name: review.reviewer_name,
            reviewer_email: review.reviewer_email,
            helpfulness: review.helpfulness,
            reported: review.reported,
            photos: review.photos
          };

          reviews.results.push(reviewObj);
          reviews.count += 1;
          reviews.page = reviews.count > 2 ? Math.ceil(reviews.count / 2) : 0;
        });

        cb(reviews);
      })
      .catch((err) => setImmediate(() => console.log(err)));
  },

  getMetadata: (id, cb) => {
    let metadata = {
      product_id: id,
      ratings: {},
      recommend: {},
      characteristics: {},
    };

    pool
      .query(`
        SELECT
          rr.ratings::varchar,
          rr.recommendations::varchar,
          json_agg(jsonb_build_object(cv.name, cv.values)) AS chars
        FROM (
          SELECT
            product_id,
            json_agg(r.rating) AS ratings,
            json_agg(r.recommend) AS recommendations
          FROM reviews r
          WHERE r.product_id = 1
          GROUP BY r.product_id
        ) rr
        JOIN (
          SELECT
              c.product_id,
              c.name,
              json_agg(json_build_object('id', cr.id, 'value', cr.value)) as values
            FROM characteristics c
              LEFT JOIN review_characteristics cr
              ON c.id = cr.characteristic_id
            WHERE c.product_id = 1
            GROUP BY c.id
        ) cv
        ON cv.product_id = rr.product_id
        GROUP BY rr.ratings::varchar, rr.recommendations::varchar;
      `)
      .then(({ rows }) => {
        const ratings = rows[0].ratings.replace('[', '').replace(']', '').split(', ');
        const recs = rows[0].recommendations.replace('[', '').replace(']', '').split(', ');
        const chars = rows[0].chars;

        // parse through ratings
        for (let i = 0; i < ratings.length; i++) {
          metadata.ratings[ratings[i]] = metadata.ratings[ratings[i]] + 1 || 1;
        }

        // parse through recommendations
        for (let i = 0; i < recs.length; i++) {
          metadata.recommend[recs[i]] = metadata.recommend[recs[i]] + 1 || 1;
        }
        // parse through characteristics
        for (let i = 0; i < chars.length; i++) {
          for (let charName in chars[i]) {
            metadata.characteristics[charName] = metadata.characteristics[charName] || { value: 0 };
            for (let j = 0; j < chars[i][charName].length; j++) {
              metadata.characteristics[charName].value += chars[i][charName][j].value;
            }
            metadata.characteristics[charName].value /= parseFloat(chars[i][charName].length);
          }
        }
        cb(metadata);
      })
      .catch((err) => setImmediate(() => console.log(err)));
  },

  postReview: async (review, cb) => {
    // add to reviews table
    await pool
      .query(`
        INSERT INTO reviews (product_id, rating, summary, body, recommend, reviewer_name, reviewer_email)
        VALUES (${review.product_id}, ${review.rating}, ${review.summary},
          ${review.body}, ${review.recommend}, ${review.name}, ${review.email});
      `)
      .catch((err) => setImmediate(() => console.log(err)));

    // grab review id of newly added review
    let reviewId = 0;
    await pool
      .query(`SELECT id FROM reviews ORDER BY id DESC LIMIT 1;`)
      .then((id) => { reviewId = id; })
      .catch((err) => setImmediate(() => console.log(err)));

    // add to photos table
    await pool
      .query(`
          DO $$
          BEGIN
            FOR url IN ${review.photos}
            LOOP
              INSERT INTO photos (${reviewId}, url)
              VALUES (url)
            END LOOP;
          END $$;
      `)
      .catch((err) => setImmediate(() => console.log(err)));

    // add to review_characteristics table
    await pool
      .query(`
        DO $$
          DECLARE
            r record;
          BEGIN
            FOR r IN ${review.characteristics}
            LOOP
              INSERT INTO review_characteristics (characteristic_id, review_id, value)
              VALUES (i.key, ${reviewId}, i.value)
            END LOOP;
          END $$;
      `)
      .then(() => cb())
      .catch((err) => setImmediate(() => console.log(err)));
  },

  markHelpful: (id, cb) => {
    pool
      .query(`
        UPDATE reviews
        SET helpfulness = (
          SELECT helpfulness
          FROM reviews
          WHERE id = ${id}
        ) + 1
        WHERE id = ${id};
      `)
      .then(() => cb())
      .catch((err) => setImmediate(() => console.log(err)));
  },

  report: (id, cb) => {
    pool
      .query(`
        UPDATE reviews
        SET reported = true
        WHERE id = ${id};
      `)
      .then(() => cb())
      .catch((err) => setImmediate(() => console.log(err)));
  }
};